import type { DocumentPickerAsset } from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { checkCancelled, ComicArchiveError, inspectArchive, verifyArchiveImages, ZIP_LIMITS } from '@/utils/zip-validation';

export type Comic = {
  id: number; name: string; uri: string; size: number; importedAt: number;
  archivePath: string | null; status: 'stored' | 'extracting' | 'ready'; error: string | null; pageCount: number;
};
// Native ZIP cancellation is global; allow only one preparation across all stores.
let preparing = false;

export function createLibraryStore(databaseName = 'library.db', archiveFolder = 'comics', cacheNamespace = 'comic') {
  if (![databaseName, archiveFolder, cacheNamespace].every((name) => /^[a-zA-Z0-9.-]+$/.test(name) && !name.startsWith('.'))) throw new Error('Invalid storage name');
  let database: Promise<SQLiteDatabase> | undefined;
  const stagingRoot = () => new Directory(Paths.cache, `${cacheNamespace}-staging`);
  const extractedRoot = () => new Directory(Paths.cache, `${cacheNamespace}-extracted`);

  function comicFile(comic: Comic) {
    if (!comic.archivePath || !comic.archivePath.startsWith(`${archiveFolder}/`) || !/^[0-9]+-[a-z0-9]+\.cbz$/.test(comic.archivePath.slice(archiveFolder.length + 1))) {
      throw new ComicArchiveError('보관 파일의 경로를 복원하지 못했습니다. 파일을 다시 가져와 주세요.');
    }
    return new File(Paths.document, comic.archivePath);
  }

  async function recover(db: SQLiteDatabase) {
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
  }

  function getDatabase() {
    database ??= (async () => {
      const db = await openDatabaseAsync(databaseName);
      try {
        await db.execAsync(`PRAGMA journal_mode = WAL;
          CREATE TABLE IF NOT EXISTS comics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL, uri TEXT NOT NULL UNIQUE,
            size INTEGER NOT NULL, importedAt INTEGER NOT NULL
          );`);
        await db.withExclusiveTransactionAsync(async (transaction) => {
          const version = (await transaction.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
          if (version > 2) throw new Error('지원하지 않는 서재 버전입니다. 앱을 업데이트해 주세요.');
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
        });
        await recover(db);
        return db;
      } catch (error) {
        await db.closeAsync();
        throw error;
      }
    })().catch((error) => { database = undefined; throw error; });
    return database;
  }

  async function listComics(): Promise<Comic[]> {
    return (await getDatabase()).getAllAsync<Comic>('SELECT * FROM comics ORDER BY importedAt DESC, id DESC');
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
        importedAt, archivePath, status: 'stored', error: null, pageCount: 0 };
    } catch (error) {
      try { if (destination?.exists) destination.delete(); } catch { /* Original error takes precedence. */ }
      throw error;
    } finally {
      try { if (source.uri.startsWith(Paths.cache.uri) && source.exists) source.delete(); } catch { /* Cache is regenerable. */ }
    }
  }

  async function prepareComic(id: number, signal?: AbortSignal): Promise<void> {
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
      await db.runAsync("UPDATE comics SET status = 'extracting', error = NULL, pageCount = 0 WHERE id = ?", id);
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
      const images = entries.filter((entry) => entry.image);
      if (Paths.availableDiskSpace < images.reduce((sum, entry) => sum + entry.size, 0) + 32 * 1024 * 1024) {
        throw new ComicArchiveError('압축을 풀 저장 공간이 부족합니다. 공간을 확보한 뒤 다시 시도해 주세요.');
      }
      staging = new Directory(stagingRoot(), String(id));
      if (staging.exists) staging.delete();
      if (final.exists) final.delete();
      staging.create({ intermediates: true });
      const { unzip, cancel } = await import('react-native-zip-archive');
      const abortNative = () => { void cancel().catch(() => {}); };
      signal?.addEventListener('abort', abortNative, { once: true });
      try {
        checkCancelled(signal);
        // Do not pass signal: the wrapper can reject before native I/O stops.
        // Await the original native promise before removing/reusing its directory.
        await unzip(decodeURIComponent(source.uri.replace(/^file:\/\//, '')),
          decodeURIComponent(staging.uri.replace(/^file:\/\//, '')), { entries: images.map((entry) => entry.path) });
      } finally { signal?.removeEventListener('abort', abortNative); }
      checkCancelled(signal);
      for (const entry of images) {
        const file = new File(staging, entry.path);
        if (!file.exists || file.size !== entry.size) throw new ComicArchiveError('추출된 이미지가 ZIP 정보와 일치하지 않습니다.');
      }
      new File(staging, 'manifest.json').write(JSON.stringify({ version: 1, entries: images }));
      extractedRoot().create({ idempotent: true, intermediates: true });
      await staging.move(final);
      checkCancelled(signal);
      await db.runAsync("UPDATE comics SET status = 'ready', error = NULL, pageCount = ? WHERE id = ?", images.length, id);
    } catch (error) {
      // Native work has settled by this point; cleanup cannot race it.
      try { if (staging?.exists) staging.delete(); if (final?.exists) final.delete(); }
      catch { /* Startup recovery removes abandoned staging directories. */ }
      const message = signal?.aborted ? '가져오기를 취소했습니다. 원본 파일은 보관됩니다.' :
        error instanceof ComicArchiveError ? error.message : 'CBZ를 처리하지 못했습니다. 파일과 저장 공간을 확인한 뒤 다시 시도해 주세요.';
      if (db) await db.runAsync("UPDATE comics SET status = 'stored', error = ?, pageCount = 0 WHERE id = ?", message, id);
      throw new ComicArchiveError(message);
    } finally { preparing = false; }
  }

  return { listComics, importComic, prepareComic, dispose: async () => {
    if (preparing) throw new Error('Extraction is still running');
    if (database) await (await database).closeAsync();
    database = undefined;
  } };
}

export const { listComics, importComic, prepareComic } = createLibraryStore();
