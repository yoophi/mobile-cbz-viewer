import type { DocumentPickerAsset } from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

export type Comic = { id: number; name: string; uri: string; size: number; importedAt: number };
let database: Promise<SQLiteDatabase> | undefined;

function getDatabase() {
  database ??= (async () => {
    const db = await openDatabaseAsync('library.db');
    await db.execAsync(`PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS comics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL, uri TEXT NOT NULL UNIQUE,
        size INTEGER NOT NULL, importedAt INTEGER NOT NULL
      ); PRAGMA user_version = 1;`);
    return db;
  })().catch((error) => { database = undefined; throw error; });
  return database;
}

export async function listComics(): Promise<Comic[]> {
  return (await getDatabase()).getAllAsync<Comic>('SELECT * FROM comics ORDER BY importedAt DESC, id DESC');
}

export async function importComic(asset: DocumentPickerAsset): Promise<void> {
  const source = new File(asset.uri);
  let destination: File | undefined;
  try {
    if (!/\.cbz$/i.test(asset.name)) throw new Error('확장자가 .cbz인 파일을 선택해 주세요.');
    const db = await getDatabase();
    const folder = new Directory(Paths.document, 'comics');
    folder.create({ intermediates: true, idempotent: true });
    // A generated name keeps external filenames from becoming filesystem paths.
    destination = new File(folder, `${Date.now()}-${Math.random().toString(36).slice(2)}.cbz`);
    source.copy(destination);
    await db.runAsync('INSERT INTO comics (name, uri, size, importedAt) VALUES (?, ?, ?, ?)',
      asset.name, destination.uri, destination.size ?? asset.size ?? 0, Date.now());
  } catch (error) {
    try {
      if (destination?.exists) destination.delete();
    } catch {
      // Preserve the original failure even if removal of a partial copy fails.
    }
    throw error;
  } finally {
    // DocumentPicker explicitly copied this file to cache; release that temporary copy.
    try {
      if (source.uri.startsWith(Paths.cache.uri) && source.exists) source.delete();
    } catch {
      // Cleanup must not turn a successful import into a reported failure.
    }
  }
}
