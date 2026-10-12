import { Directory, File, Paths } from 'expo-file-system';
import { deleteDatabaseAsync, openDatabaseAsync } from 'expo-sqlite';
import { Platform } from 'react-native';
import { createLibraryStore } from '@/services/library';
import type { ReadingSaveChannel } from '@/components/reading-save-notice';
import { DEFAULT_READING_STATE } from '@/utils/reading-state';
import { fixtureBytes } from './zip-fixture';

export async function createReadingSaveUIProbe() {
  if (!__DEV__ || Platform.OS === 'web') throw new Error('Native development build required');
  const name = 'reading-save-ui-diagnostics.db', namespace = 'readingsaveuidiagnostic';
  const dirs = [new Directory(Paths.document, `${namespace}-comics`), ...['sources', 'staging', 'extracted', 'scroll-staging']
    .map((suffix) => new Directory(Paths.cache, `${namespace}-${suffix}`))];
  try { await deleteDatabaseAsync(name); } catch { /* First run. */ }
  for (const dir of dirs) if (dir.exists) dir.delete();
  const store = createLibraryStore(name, `${namespace}-comics`, namespace);
  const connection = await openDatabaseAsync(name, { useNewConnection: true });
  const dispose = async () => {
    await store.dispose(); await connection.closeAsync();
    if (new File(Paths.document, 'SQLite', name).exists) await deleteDatabaseAsync(name);
    for (const dir of dirs) if (dir.exists) dir.delete();
  };
  let blocked = true, retries = 0;
  const resultFile = new File(Paths.document, 'reading-save-ui-probe-result.json');
  if (resultFile.exists) resultFile.delete();
  try {
    const sources = dirs[1]; sources.create();
    const file = new File(sources, 'save-warning.cbz'); file.write(fixtureBytes);
    const comic = await store.importComic({ name: 'synthetic-warning.cbz', uri: file.uri, lastModified: 0 });
    await store.openComic(comic.id); await store.saveReadingState(comic.id, DEFAULT_READING_STATE);
    await connection.execAsync(`CREATE TRIGGER reject_reading BEFORE INSERT ON comic_reading_state
      BEGIN SELECT RAISE(ABORT, 'diagnostic disk failure'); END;`);
    const desired = { index: 2, fraction: .25, mode: 'scroll' as const, direction: 'rtl' as const };
    try { await store.saveReadingState(comic.id, desired); } catch { /* Real failure appears through the shared notice. */ }
    const source: ReadingSaveChannel = { ...store, retryReadingSaves: async (id) => {
      retries++;
      try { await store.retryReadingSaves(id); }
      finally {
        const state = await store.getReadingState(comic.id, 3);
        const persisted = await connection.getFirstAsync<{ pageIndex: number; fraction: number; direction: string; mode: string }>(
          'SELECT pageIndex,fraction,mode,direction FROM comic_reading_state WHERE comicId = ?', comic.id);
        const result = { platform: Platform.OS, blocked, retries, warningVisible: store.getReadingSaveFailures().length > 0,
          persisted: Boolean(persisted && persisted.pageIndex === desired.index && persisted.fraction === desired.fraction &&
            persisted.mode === desired.mode && persisted.direction === desired.direction),
          pendingStateRetained: state.index === desired.index && state.fraction === desired.fraction };
        resultFile.write(JSON.stringify(result, null, 2));
      }
    } };
    return { id: comic.id, source, unblock: async () => { await connection.execAsync('DROP TRIGGER reject_reading'); blocked = false; }, dispose };
  } catch (cause) { await dispose(); throw cause; }
}
