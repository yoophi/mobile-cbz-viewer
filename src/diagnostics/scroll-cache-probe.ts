import { Directory, File, Paths } from 'expo-file-system';
import { deleteDatabaseAsync } from 'expo-sqlite';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';
import { zipSync } from 'fflate';
import { createLibraryStore } from '@/services/library';
import { SCROLL_CACHE_BYTES } from '@/services/scroll-cache';
import { imageBytes } from './zip-fixture';

const tick = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function padding(file: File, size: number) {
  if (file.exists) file.delete();
  file.create();
  const handle = file.open();
  const chunk = new Uint8Array(1024 * 1024);
  try {
    for (let written = 0; written < size; written += chunk.length) {
      handle.writeBytes(chunk.subarray(0, Math.min(chunk.length, size - written)));
      await tick();
    }
  } finally { handle.close(); }
  if (file.size !== size) throw new Error('Pressure fixture was not written completely');
}

export async function runScrollCacheProbe() {
  if (!__DEV__ || Platform.OS === 'web') throw new Error('Native development build required');
  if (Paths.availableDiskSpace < 384 * 1024 * 1024) throw new Error('Diagnostic needs 384 MiB free space');
  const name = 'scroll-cache-diagnostics.db';
  const namespace = 'scrollcachediagnostic';
  const dirs = [new Directory(Paths.document, `${namespace}-comics`), ...['sources', 'staging', 'extracted', 'scroll-staging']
    .map((suffix) => new Directory(Paths.cache, `${namespace}-${suffix}`))];
  const [original, sources, , extracted, staging] = dirs;
  try { await deleteDatabaseAsync(name); } catch { /* First run. */ }
  for (const dir of dirs) if (dir.exists) dir.delete();
  sources.create();
  const factory = () => createLibraryStore(name, `${namespace}-comics`, namespace);
  let store = factory();
  const leases: ReturnType<typeof store.acquireScrollPage>[] = [];
  const checks: { name: string; passed: boolean }[] = [];
  try {
    const input = new File(sources, 'input.png'); input.write(imageBytes);
    const context = ImageManipulator.manipulate(input.uri).resize({ width: 512, height: 30000 });
    const pixels = await context.renderAsync();
    let saved: File | undefined; let longBytes: Uint8Array;
    try { saved = new File((await pixels.saveAsync({ format: SaveFormat.PNG })).uri); longBytes = await saved.bytes(); }
    finally { saved?.delete(); pixels.release(); context.release(); }
    const archive = new File(sources, 'pressure.cbz');
    archive.write(zipSync({ '1.png': imageBytes, '2.png': imageBytes, '3.png': imageBytes, '4.png': longBytes }, { level: 0 }));
    const imported = await store.importComic({ name: 'synthetic-pressure.cbz', uri: archive.uri, lastModified: 0 });
    const { pages } = await store.openComic(imported.id);
    const scroll = new Directory(extracted, String(imported.id), 'scroll');
    const folder = (index: number) => new Directory(scroll, String(index));
    const pad = (index: number) => new File(folder(index), 'pressure-padding');
    const acquire = (index: number) => { const lease = store.acquireScrollPage(pages[index]); leases.push(lease); return lease; };
    const first = acquire(0); await first.promise;
    await padding(pad(0), 32 * 1024 * 1024);
    const second = acquire(1); await second.promise; second.release();
    await padding(pad(1), 64 * 1024 * 1024);
    await tick(1100); // Native file timestamps may have only second precision.
    const third = acquire(2); await third.promise; third.release();
    await padding(pad(2), 24 * 1024 * 1024);
    const long = acquire(3); await long.promise;
    checks.push({ name: '128 MiB reservation evicts the oldest unleased strips, protects active strips and keeps newer cache', passed:
      folder(0).exists && !folder(1).exists && folder(2).exists && folder(3).exists && (scroll.size ?? Infinity) <= SCROLL_CACHE_BYTES });
    pad(2).delete();
    await padding(pad(0), 120 * 1024 * 1024 - 4096);
    const currentBytes = scroll.size;
    if (currentBytes === null) throw new Error('Cannot measure pressure fixture');
    await padding(pad(3), SCROLL_CACHE_BYTES - 64 * 1024 - currentBytes);
    const rejected = acquire(1); let failed = false;
    try { await rejected.promise; } catch { failed = true; } finally { rejected.release(); }
    checks.push({ name: 'Pinned saturation fails without exceeding the cache cap or deleting active strips/source files', passed:
      failed && folder(0).exists && folder(3).exists && !folder(1).exists && (scroll.size ?? Infinity) <= SCROLL_CACHE_BYTES &&
      pages.every((page) => new File(page.uri).exists) && original.list().length === 1 });
    first.release(); long.release(); pad(0).delete(); pad(3).delete();
    const restored = acquire(1);
    try { checks.push({ name: 'Released pressure permits regeneration from the original extracted page', passed:
      (await restored.promise).uris.every((uri) => new File(uri).exists) && (extracted.size ?? Infinity) <= 512 * 1024 * 1024 }); }
    finally { restored.release(); }

    folder(3).delete();
    const cancelled = acquire(3);
    let settled = false; const outcome = cancelled.promise.then(() => false, () => true).finally(() => { settled = true; });
    const partial = new Directory(staging, String(imported.id), '3');
    const deadline = Date.now() + 20000;
    while (!new File(partial, '0.png').exists && !settled && Date.now() < deadline) await tick(5);
    const observedNativeWork = new File(partial, '0.png').exists;
    cancelled.release();
    checks.push({ name: 'Cancellation after native strip output waits for settlement and removes unpublished staging only', passed:
      await outcome && observedNativeWork && !partial.exists && !folder(3).exists && pages.every((page) => new File(page.uri).exists) });
    const retried = acquire(3);
    try { checks.push({ name: 'Interrupted long page regenerates all 30 strips without affecting other cache or original', passed:
      (await retried.promise).uris.length === 30 && folder(1).exists && original.list().length === 1 }); }
    finally { retried.release(); }
    const abandoned = new Directory(staging, '999', '0'); abandoned.create({ intermediates: true });
    new File(abandoned, 'partial.png').write(imageBytes);
    await store.dispose(); store = factory();
    const reopened = await store.openComic(imported.id);
    checks.push({ name: 'Reopening removes abandoned owned scroll staging while preserving ready pages and source archive', passed:
      !staging.exists && reopened.pages.length === 4 && reopened.comic.status === 'ready' && original.list().length === 1 });
  } finally {
    for (const lease of leases) lease.release();
    await store.dispose();
    if (new File(Paths.document, 'SQLite', name).exists) await deleteDatabaseAsync(name);
    for (const dir of dirs) if (dir.exists) dir.delete();
  }
  const result = { platform: Platform.OS, checks, passed: checks.length === 6 && checks.every((check) => check.passed) };
  new File(Paths.document, 'scroll-cache-probe-result.json').write(JSON.stringify(result, null, 2));
  return result;
}
