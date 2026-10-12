import { Directory, File, Paths } from 'expo-file-system';
import { deleteDatabaseAsync, openDatabaseAsync } from 'expo-sqlite';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';
import { zipSync } from 'fflate';

import { createLibraryStore } from '@/services/library';
import { imageBytes } from './zip-fixture';

export async function runPagesProbe() {
  if (!__DEV__ || Platform.OS === 'web') throw new Error('Native development build required');
  const databaseName = 'pages-diagnostics.db';
  const original = new Directory(Paths.document, 'pagesdiagnostic-comics');
  const sources = new Directory(Paths.cache, 'pagesdiagnostic-sources');
  const staging = new Directory(Paths.cache, 'pagesdiagnostic-staging');
  const extracted = new Directory(Paths.cache, 'pagesdiagnostic-extracted');
  const directories = [original, sources, staging, extracted];
  const store = createLibraryStore(databaseName, 'pagesdiagnostic-comics', 'pagesdiagnostic');
  const checks: { name: string; passed: boolean }[] = [];
  try { await deleteDatabaseAsync(databaseName); } catch { /* First run. */ }
  for (const dir of directories) if (dir.exists) dir.delete();
  original.create(); sources.create();
  try {
    const png = new File(sources, 'source.png'); png.write(imageBytes);
    const context = ImageManipulator.manipulate(png.uri);
    const rendered = await context.renderAsync();
    let jpeg: File | undefined; let webp: File | undefined;
    let jpegBytes: Uint8Array; let webpBytes: Uint8Array;
    try {
      jpeg = new File((await rendered.saveAsync({ format: SaveFormat.JPEG })).uri);
      webp = new File((await rendered.saveAsync({ format: SaveFormat.WEBP })).uri);
      jpegBytes = await jpeg.bytes(); webpBytes = await webp.bytes();
    } finally {
      if (jpeg?.exists) jpeg.delete(); if (webp?.exists) webp.delete();
      rendered.release(); context.release();
    }
    const expected = ['1.png', '2.webp', '10.jpg', '한글/2.png', '한글/10.png'];
    const bytes = zipSync({ '10.jpg': jpegBytes, '한글/10.png': imageBytes, '2.webp': webpBytes,
      '한글/2.png': imageBytes, '1.png': imageBytes, '.hidden.png': imageBytes, '__MACOSX/1.png': imageBytes });
    const legacy = new File(original, '1-legacy.cbz'); legacy.write(bytes);
    const db = await openDatabaseAsync(databaseName);
    try {
      await db.execAsync(`CREATE TABLE comics (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
        uri TEXT NOT NULL UNIQUE, size INTEGER NOT NULL, importedAt INTEGER NOT NULL,
        archivePath TEXT, status TEXT NOT NULL DEFAULT 'stored', error TEXT, pageCount INTEGER NOT NULL DEFAULT 0);
        PRAGMA user_version = 2;`);
      await db.runAsync('INSERT INTO comics (name, uri, size, importedAt, archivePath, status, pageCount) VALUES (?, ?, ?, ?, ?, ?, ?)',
        '페이지 샘플.cbz', legacy.uri, bytes.length, 123, 'pagesdiagnostic-comics/1-legacy.cbz', 'ready', 5);
    } finally { await db.closeAsync(); }
    const migrated = (await store.listComics())[0];
    checks.push({ name: 'v2-to-v3 migration preserves book/source metadata and requires new page cache',
      passed: migrated.name === '페이지 샘플.cbz' && migrated.importedAt === 123 && migrated.status === 'stored' && legacy.exists });
    await store.prepareComic(migrated.id);
    const pages = await store.listPages(migrated.id);
    checks.push({ name: 'Mixed PNG/WebP/JPEG pages sorted naturally; hidden entries excluded',
      passed: JSON.stringify(pages.map((page) => page.path)) === JSON.stringify(expected) && pages.every((page, index) => page.position === index && page.size > 0) });
    let decoded = true;
    for (const page of pages) {
      const image = await Image.loadAsync(page.uri, { maxWidth: 20, maxHeight: 20 });
      decoded &&= image.width > 0 && image.height > 0; image.release();
    }
    checks.push({ name: 'All three image formats decode from local files', passed: decoded });
    const book = (await store.listComics())[0];
    const cover = book.coverUri ? await Image.loadAsync(book.coverUri, { maxWidth: 240, maxHeight: 360 }) : undefined;
    checks.push({ name: 'First-page JPEG cover saved and decodable within size budget', passed:
      book.coverPath === `${book.id}/cover.jpg` && !book.coverError && Boolean(cover && cover.width <= 240 && cover.height <= 360) });
    cover?.release();
    await store.dispose();
    const restarted = await store.listPages(migrated.id);
    checks.push({ name: 'Page order and sizes persist after reopening database', passed:
      JSON.stringify(restarted.map(({ path, size, position }) => ({ path, size, position }))) === JSON.stringify(pages.map(({ path, size, position }) => ({ path, size, position }))) });

    const corrupt = new File(sources, 'damaged-image.cbz');
    corrupt.write(zipSync({ '1.png': imageBytes.slice(0, 12) }));
    const damaged = await store.importComic({ name: '손상 이미지.cbz', uri: corrupt.uri, lastModified: 0 });
    await store.prepareComic(damaged.id);
    const failedCover = (await store.listComics()).find((item) => item.id === damaged.id)!;
    checks.push({ name: 'Decoder failure becomes a cover warning without crashing the library', passed:
      failedCover.status === 'ready' && Boolean(failedCover.coverError) && !failedCover.coverPath && (await store.listPages(damaged.id)).length === 1 });
  } finally {
    await store.dispose(); await deleteDatabaseAsync(databaseName);
    for (const dir of directories) if (dir.exists) dir.delete();
  }
  const result = { platform: Platform.OS, checks, passed: checks.length === 6 && checks.every((check) => check.passed) };
  new File(Paths.document, 'pages-probe-result.json').write(JSON.stringify(result, null, 2));
  console.info('PAGES_PROBE_RESULT', JSON.stringify(result));
  return result;
}
