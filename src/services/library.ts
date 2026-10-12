import type { DocumentPickerAsset } from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { checkCancelled, ComicArchiveError, inspectArchive, verifyArchiveImages, ZIP_LIMITS } from '@/utils/zip-validation';
import { comparePagePaths } from '@/utils/page-order';
import { CACHE_LIMITS, selectCacheEvictions, type CacheEntry, type CacheBudget } from '@/utils/cache-policy';
import { readImageDimensions } from '@/utils/image-dimensions';
import { createScrollCache } from './scroll-cache';
import { createReadingStore } from './reading-store';

export type Comic = {
  id: number; name: string; uri: string; size: number; importedAt: number;
  archivePath: string | null; status: 'stored' | 'extracting' | 'ready'; error: string | null; pageCount: number;
  coverPath: string | null; coverError: string | null; coverUri?: string;
};
export type ComicPage = { comicId: number; position: number; path: string; size: number; uri: string; width: number | null; height: number | null };
// Native ZIP cancellation is global; allow only one preparation across all stores.
let preparing = false;

function pageDimensions(file: File) {
  let handle: ReturnType<File['open']> | undefined;
  try {
    if (!file.exists) return undefined;
    handle = file.open();
    const reader = handle;
    return readImageDimensions(file.size, (offset, length) => { reader.offset = offset; return reader.readBytes(length); });
  } catch { return undefined; }
  finally { handle?.close(); }
}

async function clearNativeImageDiskCache() {
  // Image.loadAsync used by cover generation has native loader defaults.
  // Pages/covers use cachePolicy=none; retain only our budgeted extracted files.
  const { Image } = await import('expo-image');
  if (!await Image.clearDiskCache()) throw new ComicArchiveError('이미지 캐시를 정리하지 못했습니다. 저장 공간을 확인해 주세요.');
}

async function createCover(source: File, destination: File) {
  const { Image } = await import('expo-image');
  const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
  const image = await Image.loadAsync(source.uri, { maxWidth: 240, maxHeight: 360 });
  const context = ImageManipulator.manipulate(image);
  let rendered: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
  let saved: File | undefined;
  try {
    rendered = await context.renderAsync();
    const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
    saved = new File(result.uri);
    await saved.copy(destination);
  } finally {
    if (saved?.exists) saved.delete();
    rendered?.release();
    context.release();
    image.release();
  }
}

export function createLibraryStore(databaseName = 'library.db', archiveFolder = 'comics', cacheNamespace = 'comic', cacheBudget: CacheBudget = CACHE_LIMITS) {
  if (![databaseName, archiveFolder, cacheNamespace].every((name) => /^[a-zA-Z0-9.-]+$/.test(name) && !name.startsWith('.'))) throw new Error('Invalid storage name');
  if (!Object.values(cacheBudget).every((value) => Number.isSafeInteger(value) && value > 0)) throw new Error('Invalid cache budget');
  let database: Promise<SQLiteDatabase> | undefined;
  const readers = new Map<number, number>();
  const stagingRoot = () => new Directory(Paths.cache, `${cacheNamespace}-staging`);
  const extractedRoot = () => new Directory(Paths.cache, `${cacheNamespace}-extracted`);
  const readingStore = createReadingStore(getDatabase);
  const scrollCache = createScrollCache(extractedRoot, () => new Directory(Paths.cache, `${cacheNamespace}-scroll-staging`),
    async (work) => {
      if (preparing) throw new ComicArchiveError('다른 파일을 처리하고 있습니다. 잠시 후 다시 시도해 주세요.');
      preparing = true;
      try { return await work(); } finally { preparing = false; }
    }, async (_id, bytes) => trimCache(await getDatabase(), undefined, bytes));

  function acquireScrollPage(page: ComicPage) {
    const releaseReader = retainComic(page.comicId);
    const lease = scrollCache.acquire(page);
    return { promise: lease.promise, release() { lease.release(); releaseReader(); } };
  }

  function retainComic(id: number) {
    readers.set(id, (readers.get(id) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = (readers.get(id) ?? 1) - 1;
      if (count) readers.set(id, count); else readers.delete(id);
    };
  }

  async function evictCache(db: SQLiteDatabase, id: number) {
    // Mark regenerable before disk deletion: interruption cannot leave a ready stale book.
    await db.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync('DELETE FROM comic_pages WHERE comicId = ?', id);
      await transaction.runAsync("UPDATE comics SET status = 'stored', pageCount = 0, coverPath = NULL, coverError = NULL, error = NULL WHERE id = ?", id);
      await transaction.runAsync('DELETE FROM comic_cache_access WHERE comicId = ?', id);
    });
    const folder = new Directory(extractedRoot(), String(id));
    if (folder.exists) folder.delete();
  }

  async function trimCache(db: SQLiteDatabase, protectedId?: number, incomingBytes = 0, incomingCoverBytes = 0) {
    const metadata = await db.getAllAsync<{ id: number; lastAccess: number }>(`SELECT c.id, COALESCE(a.lastAccess, c.importedAt) AS lastAccess
      FROM comics c LEFT JOIN comic_cache_access a ON a.comicId = c.id WHERE c.status = 'ready'`);
    const known = new Set(metadata.map((entry) => String(entry.id)));
    const root = extractedRoot();
    // Retry deletions interrupted after their metadata was made regenerable.
    // A failed deletion must not disappear from subsequent capacity accounting.
    if (root.exists) for (const item of root.list()) {
      if (item instanceof Directory && /^[0-9]+$/.test(item.name) && !known.has(item.name)
        && Number(item.name) !== protectedId && !readers.has(Number(item.name))) item.delete();
    }
    const entries: CacheEntry[] = [];
    for (const entry of metadata) {
      if (entry.id === protectedId && incomingBytes) continue;
      const folder = new Directory(extractedRoot(), String(entry.id));
      if (!folder.exists) continue;
      const bytes = folder.size;
      if (bytes === null) throw new ComicArchiveError('캐시 용량을 확인하지 못했습니다. 다시 시도해 주세요.');
      entries.push({ ...entry, bytes, coverBytes: new File(folder, 'cover.jpg').size });
    }
    const protectedIds = new Set(readers.keys());
    if (protectedId !== undefined) protectedIds.add(protectedId);
    let evictions: number[];
    try { evictions = selectCacheEvictions(entries, protectedIds, incomingBytes, incomingCoverBytes, cacheBudget); }
    catch (cause) { throw new ComicArchiveError(cause instanceof Error ? cause.message : '캐시 용량을 확보하지 못했습니다.'); }
    for (const id of evictions) await evictCache(db, id);
  }

  async function clearExtractedCache() {
    await scrollCache.stop();
    if (preparing) throw new ComicArchiveError('추출이 끝난 뒤 캐시를 정리해 주세요.');
    preparing = true;
    try {
      const db = await getDatabase();
      const entries = await db.getAllAsync<{ id: number }>("SELECT id FROM comics WHERE status = 'ready'");
      for (const { id } of entries) if (!readers.has(id)) await evictCache(db, id);
    } finally { preparing = false; }
  }

  function comicFile(comic: Comic) {
    if (!comic.archivePath || !comic.archivePath.startsWith(`${archiveFolder}/`) || !/^[0-9]+-[a-z0-9]+\.cbz$/.test(comic.archivePath.slice(archiveFolder.length + 1))) {
      throw new ComicArchiveError('보관 파일의 경로를 복원하지 못했습니다. 파일을 다시 가져와 주세요.');
    }
    return new File(Paths.document, comic.archivePath);
  }

  async function recover(db: SQLiteDatabase) {
    scrollCache.recover();
    const staging = stagingRoot();
    if (staging.exists) staging.delete();
    await db.runAsync("UPDATE comics SET status = 'stored', error = '이전 추출이 중단되었습니다. 다시 시도해 주세요.' WHERE status = 'extracting'");
    const comics = await db.getAllAsync<Comic>('SELECT * FROM comics');
    const ready = new Set(comics.filter((comic) => comic.status === 'ready').map((comic) => String(comic.id)));
    const extracted = extractedRoot();
    if (extracted.exists) for (const item of extracted.list()) {
      if (item instanceof Directory && /^[0-9]+$/.test(item.name) && !ready.has(item.name)) item.delete();
    }
    const known = new Set(comics.map((comic) => comic.archivePath));
    const originals = new Directory(Paths.document, archiveFolder);
    if (originals.exists) {
      // Only remove generated copies that never reached the database after an interrupted import.
      for (const item of originals.list()) {
        if (item instanceof File && /^[0-9]+-[a-z0-9]+\.cbz$/.test(item.name) && !known.has(`${archiveFolder}/${item.name}`)) item.delete();
      }
    }
    for (const comic of comics) {
      let exists = false;
      try { exists = comicFile(comic).exists; } catch { /* Legacy/missing paths need re-import. */ }
      if (!exists) {
        const stale = new Directory(extractedRoot(), String(comic.id));
        if (stale.exists) stale.delete();
        await db.runAsync("UPDATE comics SET status = 'stored', pageCount = 0, error = '원본 파일이 없습니다. 다시 가져와 주세요.' WHERE id = ?", comic.id);
      } else if (comic.status === 'ready' && !new File(extractedRoot(), String(comic.id), 'manifest.json').exists) {
        const stale = new Directory(extractedRoot(), String(comic.id));
        if (stale.exists) stale.delete();
        await db.runAsync("UPDATE comics SET status = 'stored', pageCount = 0, error = '추출 캐시가 정리되었습니다. 다시 추출해 주세요.' WHERE id = ?", comic.id);
      }
    }
    await db.execAsync("DELETE FROM comic_pages WHERE comicId IN (SELECT id FROM comics WHERE status != 'ready'); UPDATE comics SET coverPath = NULL, coverError = NULL WHERE status != 'ready';");
  }

  function getDatabase() {
    database ??= (async () => {
      const db = await openDatabaseAsync(databaseName);
      try {
        await db.execAsync(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;
          CREATE TABLE IF NOT EXISTS comics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL, uri TEXT NOT NULL UNIQUE,
            size INTEGER NOT NULL, importedAt INTEGER NOT NULL
          );`);
        await db.withExclusiveTransactionAsync(async (transaction) => {
          const version = (await transaction.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
          if (version > 5) throw new Error('지원하지 않는 서재 버전입니다. 앱을 업데이트해 주세요.');
          if (version < 2) {
            await transaction.execAsync(`ALTER TABLE comics ADD COLUMN archivePath TEXT;
              ALTER TABLE comics ADD COLUMN status TEXT NOT NULL DEFAULT 'stored';
              ALTER TABLE comics ADD COLUMN error TEXT;
              ALTER TABLE comics ADD COLUMN pageCount INTEGER NOT NULL DEFAULT 0;`);
            const previous = await transaction.getAllAsync<{ id: number; uri: string }>('SELECT id, uri FROM comics');
            for (const comic of previous) {
              const basename = comic.uri.split('/').pop() ?? '';
              if (/^[0-9]+-[a-z0-9]+\.cbz$/.test(basename)) await transaction.runAsync('UPDATE comics SET archivePath = ? WHERE id = ?', `${archiveFolder}/${basename}`, comic.id);
            }
            await transaction.execAsync('PRAGMA user_version = 2');
          }
          if (version < 3) {
            await transaction.execAsync(`ALTER TABLE comics ADD COLUMN coverPath TEXT;
              ALTER TABLE comics ADD COLUMN coverError TEXT;
              CREATE TABLE comic_pages (
                comicId INTEGER NOT NULL REFERENCES comics(id) ON DELETE CASCADE,
                position INTEGER NOT NULL, path TEXT NOT NULL, size INTEGER NOT NULL,
                PRIMARY KEY (comicId, position), UNIQUE (comicId, path)
              );
              UPDATE comics SET status = 'stored', pageCount = 0,
                error = '페이지 목록 형식이 변경되었습니다. 다시 추출해 주세요.' WHERE status = 'ready';
              PRAGMA user_version = 3;`);
          }
          if (version < 4) {
            await transaction.execAsync(`ALTER TABLE comic_pages ADD COLUMN width INTEGER;
              ALTER TABLE comic_pages ADD COLUMN height INTEGER;
              PRAGMA user_version = 4;`);
          }
          if (version < 5) {
            await transaction.execAsync(`CREATE TABLE comic_reading_state (
              comicId INTEGER PRIMARY KEY REFERENCES comics(id) ON DELETE CASCADE,
              pageIndex INTEGER NOT NULL, fraction REAL NOT NULL, mode TEXT NOT NULL,
              direction TEXT NOT NULL, updatedAt INTEGER NOT NULL);
              PRAGMA user_version = 5;`);
          }
        });
        await db.execAsync('CREATE TABLE IF NOT EXISTS comic_cache_access (comicId INTEGER PRIMARY KEY REFERENCES comics(id) ON DELETE CASCADE, lastAccess INTEGER NOT NULL)');
        await recover(db);
        await trimCache(db);
        await clearNativeImageDiskCache();
        return db;
      } catch (error) {
        await db.closeAsync();
        throw error;
      }
    })().catch((error) => { database = undefined; throw error; });
    return database;
  }

  async function listComics(): Promise<Comic[]> {
    const comics = await (await getDatabase()).getAllAsync<Comic>('SELECT * FROM comics ORDER BY importedAt DESC, id DESC');
    return comics.map((comic) => ({ ...comic, coverUri: comic.status === 'ready' && comic.coverPath === `${comic.id}/cover.jpg`
      ? new File(extractedRoot(), comic.coverPath).uri : undefined }));
  }

  async function listPages(id: number, signal?: AbortSignal): Promise<ComicPage[]> {
    const db = await getDatabase();
    const comic = await db.getFirstAsync<Comic>('SELECT * FROM comics WHERE id = ?', id);
    if (!comic || comic.status !== 'ready') throw new ComicArchiveError('먼저 CBZ를 검증·추출해 주세요.');
    const pages = await db.getAllAsync<Omit<ComicPage, 'uri'>>('SELECT * FROM comic_pages WHERE comicId = ? ORDER BY position', id);
    const result: ComicPage[] = [];
    for (const page of pages) {
      checkCancelled(signal);
      const file = new File(extractedRoot(), String(id), 'pages', page.path);
      // Upgrade old caches from file headers, preserving page order and ready state.
      // Pixel buffers are never loaded while building the scroll geometry.
      if (page.width === null || page.height === null) {
        const dimensions = pageDimensions(file);
        if (dimensions) {
          page.width = dimensions.width; page.height = dimensions.height;
          await db.runAsync('UPDATE comic_pages SET width = ?, height = ? WHERE comicId = ? AND position = ?', page.width, page.height, id, page.position);
        }
      }
      result.push({ ...page, uri: file.uri });
      if (result.length % 16 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    return result;
  }

  async function openComic(id: number, signal?: AbortSignal): Promise<{ comic: Comic; pages: ComicPage[] }> {
    const db = await getDatabase();
    let comic = await db.getFirstAsync<Comic>('SELECT * FROM comics WHERE id = ?', id);
    if (!comic) throw new ComicArchiveError('서재 항목을 찾을 수 없습니다.');
    checkCancelled(signal);
    if (!comicFile(comic).exists) throw new ComicArchiveError('원본 파일이 없습니다. 서재에서 다시 가져와 주세요.');
    let pages = comic.status === 'ready' ? await listPages(id, signal) : [];
    if (comic.status !== 'ready' || !pages.length || pages.some((page) => !new File(page.uri).exists)) {
      await prepareComic(id, signal);
      comic = (await db.getFirstAsync<Comic>('SELECT * FROM comics WHERE id = ?', id))!;
      pages = await listPages(id, signal);
    }
    checkCancelled(signal);
    if (!pages.length) throw new ComicArchiveError('열람할 페이지가 없습니다. 파일을 확인해 주세요.');
    await db.runAsync('INSERT OR REPLACE INTO comic_cache_access (comicId, lastAccess) VALUES (?, ?)', id, Date.now());
    return { comic, pages };
  }

  async function importComic(asset: DocumentPickerAsset): Promise<Comic> {
    const source = new File(asset.uri);
    let destination: File | undefined;
    try {
      if (!/\.cbz$/i.test(asset.name)) throw new ComicArchiveError('확장자가 .cbz인 파일을 선택해 주세요.');
      if (!source.exists || source.size === 0) throw new ComicArchiveError('파일이 비어 있거나 접근할 수 없습니다.');
      if (source.size > ZIP_LIMITS.archiveBytes) throw new ComicArchiveError('CBZ 파일은 512 MB 이하만 지원합니다.');
      const db = await getDatabase();
      const folder = new Directory(Paths.document, archiveFolder);
      folder.create({ intermediates: true, idempotent: true });
      destination = new File(folder, `${Date.now()}-${Math.random().toString(36).slice(2)}.cbz`);
      await source.copy(destination);
      const importedAt = Date.now();
      const archivePath = `${archiveFolder}/${destination.name}`;
      const result = await db.runAsync('INSERT INTO comics (name, uri, size, importedAt, archivePath) VALUES (?, ?, ?, ?, ?)',
        asset.name, destination.uri, destination.size, importedAt, archivePath);
      return { id: result.lastInsertRowId, name: asset.name, uri: destination.uri, size: destination.size,
        importedAt, archivePath, status: 'stored', error: null, pageCount: 0, coverPath: null, coverError: null };
    } catch (error) {
      try { if (destination?.exists) destination.delete(); } catch { /* Original error takes precedence. */ }
      throw error;
    } finally {
      try { if (source.uri.startsWith(Paths.cache.uri) && source.exists) source.delete(); } catch { /* Cache is regenerable. */ }
    }
  }

  async function prepareComic(id: number, signal?: AbortSignal): Promise<void> {
    await scrollCache.stop();
    checkCancelled(signal);
    if (preparing) throw new ComicArchiveError('다른 파일을 처리하고 있습니다. 잠시 후 다시 시도해 주세요.');
    preparing = true;
    let staging: Directory | undefined;
    let final: Directory | undefined;
    let db: SQLiteDatabase | undefined;
    try {
      db = await getDatabase();
      const comic = await db.getFirstAsync<Comic>('SELECT * FROM comics WHERE id = ?', id);
      if (!comic) throw new ComicArchiveError('서재 항목을 찾을 수 없습니다.');
      final = new Directory(extractedRoot(), String(id));
      checkCancelled(signal);
      await db.runAsync("UPDATE comics SET status = 'extracting', error = NULL, pageCount = 0, coverPath = NULL, coverError = NULL WHERE id = ?", id);
      await db.runAsync('DELETE FROM comic_pages WHERE comicId = ?', id);
      const source = comicFile(comic);
      if (!source.exists) throw new ComicArchiveError('원본 파일이 없습니다. 다시 가져와 주세요.');
      const handle = source.open();
      let entries;
      try {
        const read = (offset: number, length: number) => { handle.offset = offset; return handle.readBytes(length); };
        entries = inspectArchive(source.size, read);
        await verifyArchiveImages(entries, read, signal);
      } finally { handle.close(); }
      checkCancelled(signal);
      const images = entries.filter((entry) => entry.image).sort((a, b) => comparePagePaths(a.path, b.path));
      const imageBytes = images.reduce((sum, entry) => sum + entry.size, 0);
      const manifest = JSON.stringify({ version: 2, entries: images });
      // Three UTF-8 bytes per UTF-16 code unit is a safe upper bound without
      // allocating another metadata buffer. The fixed reserve covers the thumbnail.
      const estimatedBytes = imageBytes + manifest.length * 3 + cacheBudget.bookOverheadBytes;
      // Reserve cover/manifest space before native extraction allocates disk.
      if (estimatedBytes > cacheBudget.extractedBytes) throw new ComicArchiveError('추출 후 이미지가 캐시 예산을 초과합니다. 더 작은 CBZ를 선택해 주세요.');
      await trimCache(db, id, estimatedBytes, cacheBudget.bookOverheadBytes);
      if (Paths.availableDiskSpace < images.reduce((sum, entry) => sum + entry.size, 0) + 32 * 1024 * 1024) {
        throw new ComicArchiveError('압축을 풀 저장 공간이 부족합니다. 공간을 확보한 뒤 다시 시도해 주세요.');
      }
      staging = new Directory(stagingRoot(), String(id));
      if (staging.exists) staging.delete();
      if (final.exists) final.delete();
      staging.create({ intermediates: true });
      const pagesFolder = new Directory(staging, 'pages');
      pagesFolder.create();
      const { unzip, cancel } = await import('react-native-zip-archive');
      const abortNative = () => { void cancel().catch(() => {}); };
      signal?.addEventListener('abort', abortNative, { once: true });
      try {
        checkCancelled(signal);
        // Do not pass signal: the wrapper can reject before native I/O stops.
        // Await the original native promise before removing/reusing its directory.
        await unzip(decodeURIComponent(source.uri.replace(/^file:\/\//, '')),
          decodeURIComponent(pagesFolder.uri.replace(/^file:\/\//, '')), { entries: images.map((entry) => entry.path) });
      } finally { signal?.removeEventListener('abort', abortNative); }
      checkCancelled(signal);
      for (const entry of images) {
        const file = new File(pagesFolder, entry.path);
        if (!file.exists || file.size !== entry.size) throw new ComicArchiveError('추출된 이미지가 ZIP 정보와 일치하지 않습니다.');
      }
      let coverPath: string | null = null;
      let coverError: string | null = null;
      try {
        await createCover(new File(pagesFolder, images[0].path), new File(staging, 'cover.jpg'));
        coverPath = `${id}/cover.jpg`;
      } catch { coverError = '표지를 만들지 못했습니다. 페이지를 열 때 이미지 상태를 확인해 주세요.'; }
      await clearNativeImageDiskCache();
      checkCancelled(signal);
      new File(staging, 'manifest.json').write(manifest);
      const stagedBytes = staging.size;
      if (stagedBytes === null) throw new ComicArchiveError('추출 캐시 용량을 확인하지 못했습니다.');
      await trimCache(db, id, stagedBytes, new File(staging, 'cover.jpg').size);
      extractedRoot().create({ idempotent: true, intermediates: true });
      await staging.move(final);
      checkCancelled(signal);
      await db.withExclusiveTransactionAsync(async (transaction) => {
        for (const [position, entry] of images.entries()) {
          checkCancelled(signal);
          const dimensions = pageDimensions(new File(final!, 'pages', entry.path));
          await transaction.runAsync('INSERT INTO comic_pages (comicId, position, path, size, width, height) VALUES (?, ?, ?, ?, ?, ?)',
            id, position, entry.path, entry.size, dimensions?.width ?? null, dimensions?.height ?? null);
        }
        checkCancelled(signal);
        await transaction.runAsync("UPDATE comics SET status = 'ready', error = NULL, pageCount = ?, coverPath = ?, coverError = ? WHERE id = ?", images.length, coverPath, coverError, id);
        await transaction.runAsync('INSERT OR REPLACE INTO comic_cache_access (comicId, lastAccess) VALUES (?, ?)', id, Date.now());
      });
      checkCancelled(signal);
    } catch (error) {
      // Native work has settled by this point; cleanup cannot race it.
      try { if (staging?.exists) staging.delete(); if (final?.exists) final.delete(); }
      catch { /* Startup recovery removes abandoned staging directories. */ }
      const message = signal?.aborted ? '가져오기를 취소했습니다. 원본 파일은 보관됩니다.' :
        error instanceof ComicArchiveError ? error.message : 'CBZ를 처리하지 못했습니다. 파일과 저장 공간을 확인한 뒤 다시 시도해 주세요.';
      if (db) {
        await db.runAsync('DELETE FROM comic_pages WHERE comicId = ?', id);
        await db.runAsync("UPDATE comics SET status = 'stored', error = ?, pageCount = 0, coverPath = NULL, coverError = NULL WHERE id = ?", message, id);
      }
      throw new ComicArchiveError(message);
    } finally { preparing = false; }
  }

  return { listComics, listPages, openComic, importComic, prepareComic, retainComic, acquireScrollPage, clearExtractedCache, ...readingStore, dispose: async () => {
    await readingStore.drainReadingWrites();
    await scrollCache.stop();
    if (preparing) throw new Error('Extraction is still running');
    if (database) await (await database).closeAsync();
    database = undefined;
  } };
}

export const { listComics, listPages, openComic, importComic, prepareComic, retainComic, acquireScrollPage, clearExtractedCache,
  getReadingState, saveReadingState, createComicReadingWriter, getReadingSaveFailures, subscribeReadingSaveFailures, retryReadingSaves } = createLibraryStore();
