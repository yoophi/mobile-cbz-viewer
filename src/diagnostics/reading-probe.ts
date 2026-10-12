import { Directory, File, Paths } from 'expo-file-system';
import { deleteDatabaseAsync, openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';
import { zipSync } from 'fflate';
import { createLibraryStore } from '@/services/library';
import { DEFAULT_READING_STATE, type ReadingState } from '@/utils/reading-state';
import { fixtureBytes, imageBytes } from './zip-fixture';

const same = (a: ReadingState, b: ReadingState) => a.index === b.index && a.fraction === b.fraction && a.mode === b.mode && a.direction === b.direction;
export async function runReadingProbe() {
  if (!__DEV__ || Platform.OS === 'web') throw new Error('Native development build required');
  const name = 'reading-diagnostics.db', namespace = 'readingdiagnostic';
  const dirs = [new Directory(Paths.document, `${namespace}-comics`), ...['sources', 'staging', 'extracted', 'scroll-staging']
    .map((suffix) => new Directory(Paths.cache, `${namespace}-${suffix}`))];
  const [original, sources, , extracted] = dirs;
  try { await deleteDatabaseAsync(name); } catch { /* First run. */ }
  for (const dir of dirs) if (dir.exists) dir.delete();
  sources.create();
  const factory = () => createLibraryStore(name, `${namespace}-comics`, namespace);
  let store = factory(); let connection: SQLiteDatabase | undefined;
  const checks: { name: string; passed: boolean; details?: Record<string, boolean | number> }[] = [];
  try {
    const source = new File(sources, 'reading.cbz'); source.write(fixtureBytes);
    const first = await store.importComic({ name: 'synthetic-reading.cbz', uri: source.uri, lastModified: 0 });
    const before = await store.openComic(first.id);
    await store.dispose();
    connection = await openDatabaseAsync(name, { useNewConnection: true });
    await connection.execAsync('DROP TABLE comic_reading_state; DROP INDEX comic_content_identity; ALTER TABLE comics DROP COLUMN contentHash; PRAGMA user_version = 4');
    store = factory();
    const migrated = await store.openComic(first.id);
    const migration = {
      schemaVersion: (await connection.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? -1,
      ready: migrated.comic.status === 'ready', pageCount: migrated.pages.length,
      coverPresent: migrated.comic.coverPath === before.comic.coverPath && Boolean(migrated.comic.coverPath && new File(extracted, migrated.comic.coverPath).exists),
      defaultSettings: same(await store.getReadingState(first.id, 3), DEFAULT_READING_STATE), sourceCount: original.list().length,
      preservedPages: migrated.pages.length === before.pages.length && migrated.pages.every((page, index) => {
        const old = before.pages[index];
        return page.position === old.position && page.path === old.path && page.size === old.size && page.uri === old.uri && page.width === old.width && page.height === old.height;
      }),
    };
    checks.push({ name: 'v4-to-v6 migration preserves ready pages, geometry, cover and original with default reading settings', passed:
      migration.schemaVersion === 6 && migration.ready && migration.pageCount === 3 && migration.coverPresent &&
      migration.defaultSettings && migration.sourceCount === 1 && migration.preservedPages, details: migration });
    const desired: ReadingState = { index: 1, fraction: .42, mode: 'scroll', direction: 'rtl' };
    await store.saveReadingState(first.id, desired);
    await store.dispose(); store = factory();
    const restored = await store.getReadingState(first.id, 3);
    checks.push({ name: 'Page, source fraction, mode, direction and timestamp survive database reopen', passed:
      same(restored, desired) && restored.updatedAt > 0 });
    source.write(zipSync({ '1.png': imageBytes, '2.png': imageBytes, '3.png': imageBytes })); // Distinct book contents.
    const second = await store.importComic({ name: 'synthetic-other.cbz', uri: source.uri, lastModified: 0 });
    await store.openComic(second.id);
    await store.saveReadingState(second.id, { ...DEFAULT_READING_STATE, index: 2 });
    checks.push({ name: 'Reading state is isolated per book and stores no sandbox file URI', passed:
      same(await store.getReadingState(first.id, 3), desired) && (await store.getReadingState(second.id, 3)).index === 2 &&
      !(await connection.getAllAsync<{ name: string }>('PRAGMA table_info(comic_reading_state)')).some((column) => /uri|path/i.test(column.name)) });
    await store.saveReadingState(first.id, { ...desired, index: 2, fraction: .7 });
    await store.dispose();
    await connection.runAsync('UPDATE comics SET uri = ? WHERE id = ?', 'file:///old-sandbox/unreachable.cbz', first.id);
    new Directory(extracted, String(first.id)).delete();
    new File(Paths.document, first.archivePath!).write(zipSync({ '1.png': imageBytes, '2.png': imageBytes }, { level: 0 }));
    store = factory();
    const changed = await store.openComic(first.id);
    const corrected = await store.getReadingState(first.id, changed.pages.length);
    await store.saveReadingState(first.id, corrected);
    checks.push({ name: 'Relative archive path survives stale URI and missing cache; reduced page count clamps the saved anchor', passed:
      changed.pages.length === 2 && corrected.index === 1 && corrected.fraction === 0 && corrected.mode === 'scroll' && corrected.direction === 'rtl' &&
      (await connection.getFirstAsync<{ pageIndex: number }>('SELECT pageIndex FROM comic_reading_state WHERE comicId = ?', first.id))?.pageIndex === 1 });
    let notifications = 0; const unsubscribe = store.subscribeReadingSaveFailures(() => { notifications++; });
    await connection.execAsync(`CREATE TRIGGER reject_reading BEFORE INSERT ON comic_reading_state
      WHEN NEW.comicId = ${first.id} BEGIN SELECT RAISE(ABORT, 'diagnostic disk failure'); END;`);
    const unsaved = { ...desired, index: 0, fraction: .33 };
    let rejected = false;
    try { await store.saveReadingState(first.id, unsaved); } catch { rejected = true; }
    checks.push({ name: 'Actual SQLite failure rejects save, publishes a retryable warning and preserves persisted data', passed:
      rejected && notifications > 0 && store.getReadingSaveFailures()[0]?.comicId === first.id &&
      (await connection.getFirstAsync<{ pageIndex: number }>('SELECT pageIndex FROM comic_reading_state WHERE comicId = ?', first.id))?.pageIndex === 1 &&
      same(await store.getReadingState(first.id, 2), unsaved) });
    await connection.execAsync('DROP TRIGGER reject_reading');
    await store.retryReadingSaves(first.id);
    checks.push({ name: 'Retry commits the newest failed state and clears the shared warning', passed:
      notifications >= 2 && !store.getReadingSaveFailures().length && same(await store.getReadingState(first.id, 2), unsaved) });
    unsubscribe();
    await Promise.all([store.saveReadingState(first.id, { ...desired, index: 0 }), store.saveReadingState(first.id, desired),
      store.saveReadingState(first.id, { ...desired, index: 0, fraction: .9 })]);
    checks.push({ name: 'Serialized rapid saves restore the newest state rather than an older in-flight write', passed:
      same(await store.getReadingState(first.id, 2), { ...desired, index: 0, fraction: .9 }) });
    await store.clearExtractedCache();
    const remade = await store.openComic(first.id);
    checks.push({ name: 'Cache eviction and regeneration preserve durable reading state', passed:
      remade.pages.length === 2 && same(await store.getReadingState(first.id, 2), { ...desired, index: 0, fraction: .9 }) && original.list().length === 2 });
  } finally {
    await store.dispose(); await connection?.closeAsync();
    if (new File(Paths.document, 'SQLite', name).exists) await deleteDatabaseAsync(name);
    for (const dir of dirs) if (dir.exists) dir.delete();
  }
  const result = { platform: Platform.OS, checks, passed: checks.length === 8 && checks.every((check) => check.passed) };
  new File(Paths.document, 'reading-probe-result.json').write(JSON.stringify(result, null, 2));
  return result;
}
