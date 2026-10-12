import { Directory, File, Paths } from 'expo-file-system';
import { deleteDatabaseAsync, openDatabaseAsync } from 'expo-sqlite';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';
import { zipSync } from 'fflate';
import { createLibraryStore } from '@/services/library';
import { imageBytes } from './zip-fixture';

export async function runDimensionsProbe() {
  if (!__DEV__ || Platform.OS === 'web') throw new Error('Native development build required');
  const name = 'dimensions-diagnostics.db';
  const dirs = [new Directory(Paths.document, 'dimensiondiagnostic-comics'),
    new Directory(Paths.cache, 'dimensiondiagnostic-sources'), new Directory(Paths.cache, 'dimensiondiagnostic-staging'),
    new Directory(Paths.cache, 'dimensiondiagnostic-extracted'), new Directory(Paths.cache, 'dimensiondiagnostic-scroll-staging')];
  const [original, sources, , extracted] = dirs;
  try { await deleteDatabaseAsync(name); } catch { /* First run. */ }
  for (const dir of dirs) if (dir.exists) dir.delete();
  original.create(); sources.create();
  const factory = () => createLibraryStore(name, 'dimensiondiagnostic-comics', 'dimensiondiagnostic');
  let store = factory();
  const checks: { name: string; passed: boolean }[] = [];
  try {
    const input = new File(sources, 'input.png'); input.write(imageBytes);
    const context = ImageManipulator.manipulate(input.uri); context.resize({ width: 3, height: 2 });
    const rendered = await context.renderAsync();
    const data: Record<string, Uint8Array> = {};
    try {
      for (const [path, format] of [['1.png', SaveFormat.PNG], ['2.jpg', SaveFormat.JPEG], ['3.webp', SaveFormat.WEBP]] as const) {
        const saved = new File((await rendered.saveAsync({ format })).uri);
        try { data[path] = await saved.bytes(); } finally { saved.delete(); }
      }
    } finally { rendered.release(); context.release(); }
    const exif = new Uint8Array(32); exif.set([69, 120, 105, 102, 0, 0, 73, 73]);
    const view = new DataView(exif.buffer);
    view.setUint16(8, 42, true); view.setUint32(10, 8, true); view.setUint16(14, 1, true);
    view.setUint16(16, 274, true); view.setUint16(18, 3, true); view.setUint32(20, 1, true); view.setUint16(24, 6, true);
    const jpeg = data['2.jpg']; const rotated = new Uint8Array(jpeg.length + 36);
    rotated.set(jpeg.slice(0, 2)); rotated.set([255, 225, 0, 34, ...exif], 2); rotated.set(jpeg.slice(2), 38);
    data['2.jpg'] = rotated; data['4.png'] = imageBytes.slice(0, 12);
    const longContext = ImageManipulator.manipulate(input.uri).resize({ width: 512, height: 30000 });
    const longPixels = await longContext.renderAsync();
    let longFile: File | undefined;
    try { longFile = new File((await longPixels.saveAsync({ format: SaveFormat.PNG })).uri); data['5.png'] = await longFile.bytes(); }
    finally { longFile?.delete(); longPixels.release(); longContext.release(); }
    const folder = new Directory(extracted, '1'); const pagesFolder = new Directory(folder, 'pages');
    pagesFolder.create({ intermediates: true });
    for (const [path, bytes] of Object.entries(data)) new File(pagesFolder, path).write(bytes);
    new File(folder, 'manifest.json').write('{"version":2}'); new File(folder, 'cover.jpg').write(rotated);
    const archive = new File(original, '1-legacy.cbz'); archive.write(zipSync(data));
    const legacy = await openDatabaseAsync(name);
    try {
      await legacy.execAsync(`CREATE TABLE comics (id INTEGER PRIMARY KEY, name TEXT NOT NULL, uri TEXT NOT NULL UNIQUE,
        size INTEGER NOT NULL, importedAt INTEGER NOT NULL, archivePath TEXT, status TEXT NOT NULL, error TEXT,
        pageCount INTEGER NOT NULL, coverPath TEXT, coverError TEXT);
        CREATE TABLE comic_pages (comicId INTEGER NOT NULL REFERENCES comics(id) ON DELETE CASCADE,
        position INTEGER NOT NULL, path TEXT NOT NULL, size INTEGER NOT NULL,
        PRIMARY KEY (comicId, position), UNIQUE (comicId, path)); PRAGMA user_version = 3;`);
      await legacy.runAsync("INSERT INTO comics VALUES (1, ?, ?, ?, 123, ?, 'ready', NULL, 4, '1/cover.jpg', NULL)",
        'dimensions.cbz', archive.uri, archive.size, 'dimensiondiagnostic-comics/1-legacy.cbz');
      await legacy.runAsync('UPDATE comics SET pageCount = 5 WHERE id = 1');
      for (const [position, path] of Object.keys(data).entries()) await legacy.runAsync('INSERT INTO comic_pages VALUES (1, ?, ?, ?)', position, path, data[path].length);
    } finally { await legacy.closeAsync(); }
    const book = (await store.listComics())[0];
    checks.push({ name: 'v3 ready book, cover, order and original are preserved during v4 migration', passed:
      book.status === 'ready' && book.pageCount === 5 && book.importedAt === 123 && Boolean(book.coverUri) && archive.exists });
    const pages = await store.listPages(1);
    checks.push({ name: 'Bounded file header backfill obtains PNG/JPEG/WebP ratios and EXIF rotation', passed:
      pages[0].width === 3 && pages[0].height === 2 && pages[1].width === 2 && pages[1].height === 3 &&
      pages[2].width === 3 && pages[2].height === 2 && pages[3].width === null && pages[3].height === null });
    let matches = true;
    for (const page of pages.slice(0, 3)) {
      const image = await Image.loadAsync(page.uri, { maxWidth: 20, maxHeight: 20 });
      const normalization = ImageManipulator.manipulate(image); const normalized = await normalization.renderAsync();
      try { matches &&= normalized.width === page.width && normalized.height === page.height; }
      finally { normalized.release(); normalization.release(); image.release(); }
    }
    checks.push({ name: 'Header geometry matches native normalized image dimensions', passed: matches });
    await store.dispose(); store = factory();
    const reopened = await store.listPages(1);
    checks.push({ name: 'Geometry persists across reopen; corrupt metadata remains nonfatal and nullable', passed:
      JSON.stringify(reopened.map(({ width, height }) => [width, height])) === JSON.stringify(pages.map(({ width, height }) => [width, height])) &&
      (await store.listComics())[0].status === 'ready' && archive.exists });
    let croppedMatches = true;
    for (const page of reopened.slice(0, 3)) {
      const lease = store.acquireScrollPage(page);
      try {
        const { uris } = await lease.promise;
        const pixels = await Image.loadAsync(uris[0]);
        try { croppedMatches &&= pixels.width === page.width && pixels.height === page.height; }
        finally { pixels.release(); }
      } finally { lease.release(); }
    }
    checks.push({ name: 'Published PNG bands survive staging cleanup and normalize JPEG EXIF orientation', passed: croppedMatches });
    const longPage = reopened[4];
    const first = store.acquireScrollPage(longPage); const second = store.acquireScrollPage(longPage);
    let longUris: string[] = [];
    try {
      first.release(); // Another visible band still owns the shared job.
      const result = await second.promise; longUris = result.uris;
      let height = 0; let widths = true;
      for (const uri of longUris) {
        const pixels = await Image.loadAsync(uri);
        try { height += pixels.height; widths &&= pixels.width === 512 && pixels.height <= 1024; }
        finally { pixels.release(); }
      }
      checks.push({ name: 'Shared source job creates 30 bounded strips covering a 512x30000 image without gaps', passed:
        longUris.length === 30 && widths && height === 30000 });
    } finally { first.release(); second.release(); }
    new File(longUris[3]).delete();
    const regenerated = store.acquireScrollPage(longPage);
    try {
      const result = await regenerated.promise;
      checks.push({ name: 'Missing strip regenerates the complete atomic page cache while original survives', passed:
        result.uris.length === 30 && result.uris.every((uri) => new File(uri).exists) && archive.exists && new File(longPage.uri).exists });
    } finally { regenerated.release(); }
    const cancelled = store.acquireScrollPage(longPage); cancelled.release();
    let rejected = false;
    try { await cancelled.promise; } catch { rejected = true; }
    checks.push({ name: 'Unreferenced queued work cancels before native decode and preserves published files', passed:
      rejected && longUris.every((uri) => new File(uri).exists) && archive.exists });
  } finally {
    await store.dispose();
    if (new File(Paths.document, 'SQLite', name).exists) await deleteDatabaseAsync(name);
    for (const dir of dirs) if (dir.exists) dir.delete();
  }
  const result = { platform: Platform.OS, checks, passed: checks.length === 8 && checks.every((check) => check.passed) };
  new File(Paths.document, 'dimensions-probe-result.json').write(JSON.stringify(result, null, 2));
  return result;
}
