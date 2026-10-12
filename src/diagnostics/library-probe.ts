import { Directory, File, Paths } from 'expo-file-system';
import { deleteDatabaseAsync, openDatabaseAsync } from 'expo-sqlite';
import { Platform } from 'react-native';

import { createLibraryStore } from '@/services/library';
import { fixtureBytes, hostileFixtures } from './zip-fixture';

export async function runLibraryProbe() {
  if (!__DEV__ || Platform.OS === 'web') throw new Error('Native development build required');
  const databaseName = 'library-diagnostics.db';
  const folder = new Directory(Paths.document, 'diagnostic-comics');
  const staging = new Directory(Paths.cache, 'diagnostic-staging');
  const extracted = new Directory(Paths.cache, 'diagnostic-extracted');
  const sourceFolder = new Directory(Paths.cache, 'diagnostic-sources');
  const checks: { name: string; passed: boolean; detail?: string }[] = [];
  const store = createLibraryStore(databaseName, 'diagnostic-comics', 'diagnostic');
  // This store is isolated from the user's library and contains only public synthetic samples.
  try { await deleteDatabaseAsync(databaseName); } catch { /* First run has no database. */ }
  for (const directory of [folder, staging, extracted, sourceFolder]) if (directory.exists) directory.delete();
  folder.create();
  sourceFolder.create();
  try {
    const legacy = new File(folder, '1-legacy.cbz');
    legacy.write(fixtureBytes);
    const initial = await openDatabaseAsync(databaseName);
    try {
      await initial.execAsync(`CREATE TABLE comics (id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL, uri TEXT NOT NULL UNIQUE, size INTEGER NOT NULL, importedAt INTEGER NOT NULL);
        PRAGMA user_version = 1;`);
      await initial.runAsync('INSERT INTO comics (name, uri, size, importedAt) VALUES (?, ?, ?, ?)',
        '이전 서재.cbz', 'file:///old-container/comics/1-legacy.cbz', fixtureBytes.length, 123);
    } finally { await initial.closeAsync(); }
    const migrated = (await store.listComics())[0];
    checks.push({ name: 'v1 migration preserves metadata and restores relative source path',
      passed: migrated.name === '이전 서재.cbz' && migrated.importedAt === 123 && migrated.archivePath === 'diagnostic-comics/1-legacy.cbz' });
    await store.prepareComic(migrated.id);
    const prepared = (await store.listComics())[0];
    const manifest = new File(extracted, String(prepared.id), 'manifest.json');
    checks.push({ name: 'Validated CBZ commits ready state and three image files', passed: prepared.status === 'ready' &&
      prepared.pageCount === 3 && manifest.exists && new File(extracted, String(prepared.id), 'pages', '한글 폴더/중첩/10.png').exists });
    checks.push({ name: 'Non-image entries are never extracted; original remains', passed:
      !new File(extracted, String(prepared.id), 'pages', 'notes.txt').exists && legacy.exists });

    const corrupt = new File(sourceFolder, 'corrupt.cbz');
    corrupt.write(fixtureBytes.slice(0, 40));
    const imported = await store.importComic({ name: '손상 샘플.cbz', uri: corrupt.uri, lastModified: 0 });
    let rejected = false;
    try { await store.prepareComic(imported.id); } catch { rejected = true; }
    const failed = (await store.listComics()).find((comic) => comic.id === imported.id)!;
    checks.push({ name: 'Corrupt CBZ retains original and retryable error without cache output', passed: rejected &&
      failed.status === 'stored' && Boolean(failed.error) && new File(Paths.document, failed.archivePath!).exists && !new Directory(extracted, String(failed.id)).exists });

    const controller = new AbortController();
    controller.abort();
    try { await store.prepareComic(migrated.id, controller.signal); } catch { /* Expected cancellation. */ }
    checks.push({ name: 'Pre-cancel retains original source', passed: legacy.exists });

    const { subscribe } = await import('react-native-zip-archive');
    const activeController = new AbortController();
    let progressEvents = 0;
    const subscription = subscribe(() => { progressEvents++; activeController.abort(); });
    let cancelled = false;
    try { await store.prepareComic(migrated.id, activeController.signal); }
    catch { cancelled = activeController.signal.aborted; }
    finally { subscription.remove(); }
    const cancelledComic = (await store.listComics()).find((comic) => comic.id === migrated.id)!;
    checks.push({ name: 'Cancel during native extraction settles before cleanup and retains original', passed:
      cancelled && cancelledComic.status === 'stored' && !new Directory(extracted, String(migrated.id)).exists && legacy.exists,
      detail: JSON.stringify({ progressEvents, cancelled, status: cancelledComic.status, cacheExists: new Directory(extracted, String(migrated.id)).exists, sourceExists: legacy.exists }) });
    await store.prepareComic(migrated.id);
    checks.push({ name: 'Retry after native cancellation completes', passed: (await store.listComics()).find((comic) => comic.id === migrated.id)?.status === 'ready' });

    for (const fixture of hostileFixtures) {
      const sample = new File(sourceFolder, `${fixture.name}.cbz`);
      sample.write(fixture.bytes);
      const comic = await store.importComic({ name: `${fixture.name}.cbz`, uri: sample.uri, lastModified: 0 });
      let refused = false;
      try { await store.prepareComic(comic.id); } catch { refused = true; }
      const row = (await store.listComics()).find((item) => item.id === comic.id)!;
      checks.push({ name: `Reject ${fixture.name} without extraction or loss of original`, passed:
        refused && row.status === 'stored' && Boolean(row.error) && new File(Paths.document, row.archivePath!).exists &&
        !new Directory(extracted, String(comic.id)).exists && !new Directory(staging, String(comic.id)).exists });
    }

    await store.dispose();
    const interrupted = await openDatabaseAsync(databaseName);
    try { await interrupted.runAsync("UPDATE comics SET status = 'extracting' WHERE id = ?", migrated.id); }
    finally { await interrupted.closeAsync(); }
    staging.create({ idempotent: true });
    new File(staging, 'partial.png').write('partial');
    const recovered = (await store.listComics()).find((comic) => comic.id === migrated.id)!;
    checks.push({ name: 'Restart removes staging/uncommitted final cache and restores retryable state', passed:
      recovered.status === 'stored' && Boolean(recovered.error) && !staging.exists && !new Directory(extracted, String(migrated.id)).exists && legacy.exists });
    await store.prepareComic(migrated.id);
    checks.push({ name: 'Retry after interruption completes', passed: (await store.listComics()).find((comic) => comic.id === migrated.id)?.status === 'ready' });

    await store.dispose();
    extracted.delete();
    checks.push({ name: 'Purged extraction cache is recoverable after restart', passed: (await store.listComics()).find((comic) => comic.id === migrated.id)?.status === 'stored' });
    await store.prepareComic(migrated.id);
    await store.dispose();
    legacy.delete();
    const missing = (await store.listComics()).find((comic) => comic.id === migrated.id)!;
    checks.push({ name: 'Missing source resets ready state and removes stale extraction cache', passed:
      missing.status === 'stored' && missing.pageCount === 0 && Boolean(missing.error) && !new Directory(extracted, String(migrated.id)).exists });
  } finally {
    await store.dispose();
    await deleteDatabaseAsync(databaseName);
    for (const directory of [folder, staging, extracted, sourceFolder]) if (directory.exists) directory.delete();
  }
  const result = { platform: Platform.OS, checks, passed: checks.length === 17 && checks.every((check) => check.passed) };
  new File(Paths.document, 'library-probe-result.json').write(JSON.stringify(result, null, 2));
  console.info('LIBRARY_PROBE_RESULT', JSON.stringify(result));
  return result;
}
