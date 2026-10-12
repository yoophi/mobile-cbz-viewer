import { Directory, File, Paths } from 'expo-file-system';
import { deleteDatabaseAsync, openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';
import { zipSync } from 'fflate';
import { createLibraryStore, DuplicateComicError } from '@/services/library';
import { imageBytes } from './zip-fixture';
import { ComicArchiveError } from '@/utils/zip-validation';

export async function runFileManagementProbe() {
  if (!__DEV__ || Platform.OS === 'web') throw new Error('Native development build required');
  const name = 'file-management-diagnostics.db';
  const original = new Directory(Paths.document, 'filediagnostic-comics');
  const sources = new Directory(Paths.cache, 'filediagnostic-sources');
  const extracted = new Directory(Paths.cache, 'filediagnostic-extracted');
  const dirs = [original, sources, extracted, new Directory(Paths.cache, 'filediagnostic-staging'), new Directory(Paths.cache, 'filediagnostic-scroll-staging')];
  const failedFolder = new Directory(Paths.document, 'filediagnostic-copy-fail');
  const conflict = new File(Paths.document, failedFolder.name);
  const failedDb = 'file-copy-fail-diagnostics.db';
  try { await deleteDatabaseAsync(name); } catch { /* First run. */ }
  for (const dir of dirs) if (dir.exists) dir.delete();
  sources.create();
  let store = createLibraryStore(name, original.name, 'filediagnostic');
  let db: SQLiteDatabase | undefined;
  const checks: { name: string; passed: boolean }[] = [];
  const asset = (label: string, value: number) => {
    const source = new File(sources, 'picked.cbz');
    source.write(zipSync({ '1.png': imageBytes, '2.png': imageBytes, 'identity.txt': new Uint8Array([value]) },
      { level: 0, mtime: new Date('2020-01-01T00:00:00Z') }));
    return { name: label, uri: source.uri, lastModified: 0 };
  };
  const check = (label: string, passed: boolean) => { checks.push({ name: label, passed }); if (!passed) throw new Error(label); };
  const reading = { index: 1, fraction: .37, mode: 'scroll' as const, direction: 'rtl' as const };
  try {
    const first = await store.importComic(asset('same-name.cbz', 1));
    await store.openComic(first.id); await store.saveReadingState(first.id, reading);
    const originalFile = new File(first.uri);
    check('Imported native content identifier matches the managed original', first.contentHash === originalFile.md5 && original.list().length === 1);
    await store.dispose();
    db = await openDatabaseAsync(name);
    await db.execAsync('DROP INDEX comic_content_identity; ALTER TABLE comics DROP COLUMN contentHash; PRAGMA user_version = 5');
    await db.closeAsync(); db = undefined;
    store = createLibraryStore(name, original.name, 'filediagnostic');
    const migrated = (await store.openComic(first.id)).comic;
    db = await openDatabaseAsync(name);
    check('v5-to-v6 migration preserves original, cover, pages and reading state',
      (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version === 6 && migrated.status === 'ready'
      && migrated.coverPath === `${first.id}/cover.jpg` && (await store.listPages(first.id)).length === 2
      && (await store.getReadingState(first.id, 2)).fraction === reading.fraction && originalFile.exists);
    let duplicate: unknown;
    try { await store.importComic(asset('renamed.cbz', 1)); } catch (error) { duplicate = error; }
    check('Renamed duplicate is rejected without another original or row; legacy hash is filled lazily',
      duplicate instanceof DuplicateComicError && duplicate.comic.id === first.id && (await store.listComics()).length === 1
      && original.list().length === 1 && Boolean((await store.listComics())[0].contentHash));
    const second = await store.importComic(asset('same-name.cbz', 2));
    await store.openComic(second.id); await store.saveReadingState(second.id, reading);
    check('Same name with different contents remains a separate readable book', second.id !== first.id && (await store.listComics()).length === 2);
    const thirdAsset = asset('same-name.cbz', 3);
    const thirdHash = new File(thirdAsset.uri).md5;
    await db.runAsync('UPDATE comics SET contentHash = ? WHERE id = ?', thirdHash, first.id);
    const third = await store.importComic(thirdAsset);
    check('Forced hash-candidate collision does not discard byte-different content', third.id !== first.id && (await store.listComics()).length === 3);
    await db.runAsync('UPDATE comics SET contentHash = ? WHERE id = ?', originalFile.md5, first.id);
    const release = store.retainComic(first.id);
    let refused = false;
    try { await store.deleteComic(first.id); } catch { refused = true; }
    finally { release(); }
    check('An active reader protects the original and metadata from deletion', refused && originalFile.exists && (await store.listPages(first.id)).length === 2);
    const scroll = new Directory(extracted, String(first.id), 'scroll'); scroll.create(); new File(scroll, 'own-band.png').write(imageBytes);
    await store.deleteComic(first.id);
    check('Deletion removes original, extracted cover/scroll cache and foreign-key reading/page/access rows',
      !originalFile.exists && !new Directory(extracted, String(first.id)).exists
      && (await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM comic_pages WHERE comicId = ?', first.id))?.count === 0
      && (await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM comic_reading_state WHERE comicId = ?', first.id))?.count === 0
      && (await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM comic_cache_access WHERE comicId = ?', first.id))?.count === 0);
    check('Deleting one book preserves other originals, ready pages and reading position', new File(second.uri).exists
      && (await store.openComic(second.id)).pages.length === 2 && (await store.getReadingState(second.id, 2)).fraction === reading.fraction);
    await db.execAsync(`CREATE TRIGGER fail_delete BEFORE DELETE ON comics WHEN OLD.id = ${third.id} BEGIN SELECT RAISE(ABORT, 'synthetic deletion failure'); END`);
    let failed = false;
    try { await store.deleteComic(third.id); } catch { failed = true; }
    check('Partial deletion stays visible as retryable durable intent', failed && (await store.listComics()).some((book) => book.id === third.id && book.status === 'deleting' && Boolean(book.error)));
    try { await store.prepareComic(third.id); } catch { /* Deliberately refused. */ }
    check('Extraction cannot reset or resurrect a pending deletion', (await store.listComics()).find((book) => book.id === third.id)?.status === 'deleting');
    await db.execAsync('DROP TRIGGER fail_delete');
    await store.deleteComic(third.id);
    check('Retry completes partially deleted book without touching the other book', !(await store.listComics()).some((book) => book.id === third.id) && new File(second.uri).exists);
    await db.runAsync("UPDATE comics SET status = 'deleting' WHERE id = ?", second.id);
    await db.closeAsync(); db = undefined; await store.dispose(); store = createLibraryStore(name, original.name, 'filediagnostic');
    check('Startup resumes interrupted deletion intent', (await store.listComics()).length === 0 && !new File(second.uri).exists && !new Directory(extracted, String(second.id)).exists);
    const missing = await store.importComic(asset('recover.cbz', 4));
    await store.openComic(missing.id); await store.saveReadingState(missing.id, reading);
    new File(missing.uri).delete(); await store.dispose(); store = createLibraryStore(name, original.name, 'filediagnostic');
    check('Missing originals are shown for explicit re-import', (await store.listComics())[0].sourceMissing === true);
    let mismatch = false;
    try { await store.importComic(asset('wrong.cbz', 5), missing.id); } catch { mismatch = true; }
    check('Explicit re-import rejects an identifier mismatch without replacing reading state', mismatch && (await store.getReadingState(missing.id, 2)).fraction === reading.fraction);
    const restored = await store.importComic(asset('recover.cbz', 4), missing.id);
    await store.openComic(restored.id);
    check('Explicit matching re-import restores the same book and preserves reading state', restored.id === missing.id
      && !(await store.listComics())[0].sourceMissing && (await store.getReadingState(restored.id, 2)).fraction === reading.fraction);
    new File(restored.uri).delete(); await store.deleteComic(restored.id);
    check('Deleting an already missing original still cleans the library', (await store.listComics()).length === 0);
    try { await deleteDatabaseAsync(failedDb); } catch { /* First run. */ }
    if (failedFolder.exists) failedFolder.delete();
    conflict.write(new Uint8Array([1]));
    const failing = createLibraryStore(failedDb, failedFolder.name, 'filediagnosticfail');
    try {
      let copyFailed = false;
      try { await failing.importComic(asset('copy-failure.cbz', 6)); }
      catch (error) { copyFailed = error instanceof ComicArchiveError && error.message.includes('저장 공간'); }
      check('Native destination creation failure leaves no phantom book or picker copy', copyFailed
        && (await failing.listComics()).length === 0 && !new File(sources, 'picked.cbz').exists);
      conflict.delete();
      const retry = await failing.importComic(asset('copy-failure.cbz', 6));
      check('Import can retry after fixing native destination failure', new File(retry.uri).exists && (await failing.listComics()).length === 1);
      await failing.deleteComic(retry.id);
    } finally { await failing.dispose(); }
  } finally {
    await db?.closeAsync();
    await store.dispose(); await deleteDatabaseAsync(name);
    for (const dir of dirs) if (dir.exists) dir.delete();
    if (failedFolder.exists) failedFolder.delete();
    if (conflict.exists) conflict.delete();
    try { await deleteDatabaseAsync(failedDb); } catch { /* No failed-store database. */ }
  }
  const result = { platform: Platform.OS, checks, passed: checks.length === 18 && checks.every((check) => check.passed) };
  new File(Paths.document, 'file-management-probe-result.json').write(JSON.stringify(result, null, 2));
  return result;
}
