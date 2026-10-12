export type ReadingState = { index: number; fraction: number; mode: 'page' | 'scroll'; direction: 'ltr' | 'rtl' };
export const DEFAULT_READING_STATE: ReadingState = { index: 0, fraction: 0, mode: 'page', direction: 'ltr' };

export function normalizeReadingState(value: Partial<ReadingState> | null | undefined, pageCount: number): ReadingState {
  const validIndex = Number.isSafeInteger(value?.index) && value!.index! >= 0;
  const requested = validIndex ? value!.index! : 0;
  const last = Number.isSafeInteger(pageCount) && pageCount > 0 ? pageCount - 1 : 0;
  const index = Math.min(requested, last);
  const fraction = pageCount > 0 && validIndex && index === requested && Number.isFinite(value?.fraction)
    ? Math.max(0, Math.min(1, value!.fraction!)) : 0;
  return { index, fraction, mode: value?.mode === 'scroll' ? 'scroll' : 'page', direction: value?.direction === 'rtl' ? 'rtl' : 'ltr' };
}

type WriterOptions = { interval?: number; now?: () => number;
  setTimer?: (callback: () => void, delay: number) => unknown; clearTimer?: (handle: unknown) => void };

// Coalesce scroll events, serialize writes, and retain failed data for explicit retry.
// flush bypasses the interval at lifecycle boundaries and waits for the latest revision.
export function createReadingWriter(write: (value: ReadingState) => Promise<void>, onError: (cause: unknown) => void, options: WriterOptions = {}) {
  const interval = options.interval ?? 1000;
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let timer: unknown; let latest: ReadingState | undefined;
  let revision = 0; let saved = 0; let attempted = 0; let lastStarted = -Infinity;
  let running: Promise<void> | undefined; let stopped = false;
  function cancelTimer() { if (timer !== undefined) { clearTimer(timer); timer = undefined; } }
  function schedule() {
    if (stopped || running || timer !== undefined || revision === saved) return;
    timer = setTimer(() => {
      timer = undefined;
      void run().catch(() => { /* onError is the required visible error channel. */ });
    }, Math.max(0, interval - (now() - lastStarted)));
  }
  function run(): Promise<void> {
    if (running) return running;
    if (!latest || saved === revision) return Promise.resolve();
    const value = { ...latest }; const target = revision;
    attempted = target; lastStarted = now();
    const operation = Promise.resolve().then(() => write(value)).then(() => { saved = target; }, (cause) => { onError(cause); throw cause; });
    running = operation.finally(() => {
      running = undefined;
      // A failed revision waits for explicit retry; newer interaction still saves.
      if (revision > attempted) schedule();
    });
    return running;
  }
  function update(value: ReadingState) {
    if (stopped) return;
    if (latest && Object.keys(value).every((key) => value[key as keyof ReadingState] === latest![key as keyof ReadingState])) return;
    latest = { ...value }; revision++; schedule();
  }
  async function flush() {
    cancelTimer();
    while (saved < revision) {
      await run();
      cancelTimer();
    }
  }
  async function dispose() { stopped = true; cancelTimer(); await flush(); }
  return { update, flush, dispose };
}
