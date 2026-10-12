import type { SQLiteDatabase } from 'expo-sqlite';
import { createReadingWriter, normalizeReadingState, type ReadingState } from '@/utils/reading-state';

export type ReadingSaveFailure = { comicId: number; message: string };
type Row = { pageIndex: number; fraction: number; mode: ReadingState['mode']; direction: ReadingState['direction']; updatedAt: number };
const message = '읽던 위치를 저장하지 못했습니다. 저장 공간을 확인하고 다시 시도해 주세요.';

export function createReadingStore(database: () => Promise<SQLiteDatabase>) {
  const writes = new Map<number, Promise<void>>();
  const pending = new Map<number, { state: ReadingState }>();
  const failures = new Map<number, ReadingSaveFailure>();
  const listeners = new Set<() => void>();
  let snapshot: ReadingSaveFailure[] = [];
  function publish() {
    snapshot = [...failures.values()].sort((a, b) => a.comicId - b.comicId);
    for (const listener of listeners) listener();
  }
  function failed(id: number) {
    if (!failures.has(id)) { failures.set(id, { comicId: id, message }); publish(); }
  }
  function saveReadingState(id: number, input: ReadingState): Promise<void> {
    const value = { state: normalizeReadingState(input, Number.MAX_SAFE_INTEGER) };
    pending.set(id, value);
    const operation = (writes.get(id) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const db = await database();
      const comic = await db.getFirstAsync<{ pageCount: number; status: string }>('SELECT pageCount, status FROM comics WHERE id = ?', id);
      if (!comic) throw new Error('Book no longer exists');
      const state = normalizeReadingState(value.state, comic.status === 'ready' && comic.pageCount > 0 ? comic.pageCount : Number.MAX_SAFE_INTEGER);
      await db.runAsync(`INSERT INTO comic_reading_state (comicId, pageIndex, fraction, mode, direction, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(comicId) DO UPDATE SET pageIndex=excluded.pageIndex,
        fraction=excluded.fraction, mode=excluded.mode, direction=excluded.direction, updatedAt=excluded.updatedAt`,
      id, state.index, state.fraction, state.mode, state.direction, Date.now());
      if (pending.get(id) === value) {
        pending.delete(id);
        if (failures.delete(id)) publish();
      }
    }).catch(() => { failed(id); throw new Error(message); });
    writes.set(id, operation);
    const cleanup = () => { if (writes.get(id) === operation) writes.delete(id); };
    void operation.then(cleanup, cleanup);
    return operation;
  }
  async function getReadingState(id: number, pageCount: number) {
    // A blur-triggered save is queued synchronously before another focus restores.
    await writes.get(id)?.catch(() => {});
    const row = await (await database()).getFirstAsync<Row>('SELECT pageIndex, fraction, mode, direction, updatedAt FROM comic_reading_state WHERE comicId = ?', id);
    const unsaved = failures.has(id) ? pending.get(id)?.state : undefined;
    return { ...normalizeReadingState(unsaved ?? (row && { index: row.pageIndex, ...row }), pageCount),
      updatedAt: row && Number.isSafeInteger(row.updatedAt) && row.updatedAt >= 0 ? row.updatedAt : 0 };
  }
  function createComicReadingWriter(id: number) {
    return createReadingWriter((value) => saveReadingState(id, value), () => failed(id));
  }
  async function retryReadingSaves(id?: number) {
    let rejected = false;
    for (const failure of snapshot) {
      if (id !== undefined && failure.comicId !== id) continue;
      const value = pending.get(failure.comicId);
      if (value) try { await saveReadingState(failure.comicId, value.state); } catch { rejected = true; }
    }
    if (rejected) throw new Error(message);
  }
  return { saveReadingState, getReadingState, createComicReadingWriter, retryReadingSaves,
    getReadingSaveFailures: () => snapshot,
    subscribeReadingSaveFailures: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    drainReadingWrites: async () => { await Promise.allSettled([...writes.values()]); } };
}
