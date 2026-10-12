import { Directory, File, Paths } from 'expo-file-system';
import { deleteDatabaseAsync } from 'expo-sqlite';
import { Platform } from 'react-native';
import { createLibraryStore, type Comic } from '@/services/library';
import { fixtureBytes } from './zip-fixture';

export async function runCacheProbe() {
  if (!__DEV__ || Platform.OS === 'web') throw new Error('Native development build required');
  const name = 'cache-diagnostics.db';
  const dirs = ['cachediagnostic-comics', 'cachediagnostic-sources', 'cachediagnostic-staging', 'cachediagnostic-extracted']
    .map((folder, index) => new Directory(index === 0 ? Paths.document : Paths.cache, folder));
  const [original, sources, , extracted] = dirs;
  try { await deleteDatabaseAsync(name); } catch { /* First run. */ }
  for (const folder of dirs) if (folder.exists) folder.delete();
  sources.create();
  const store = createLibraryStore(name, 'cachediagnostic-comics', 'cachediagnostic',
    { extractedBytes: 32 * 1024, coverBytes: 8 * 1024, bookOverheadBytes: 1024 });
  const checks: { name: string; passed: boolean }[] = [];
  let release: (() => void) | undefined;
  try {
    const books: Comic[] = [];
    for (let i = 0; i < 3; i++) {
      const bytes = new Uint8Array(fixtureBytes.length + 1); bytes.set(fixtureBytes);
      bytes[fixtureBytes.length - 2] = 1; bytes[fixtureBytes.length] = i; // Distinct valid ZIP comments.
      const file = new File(sources, `${i}.cbz`); file.write(bytes);
      books.push(await store.importComic({ name: `cache-${i}.cbz`, uri: file.uri, lastModified: 0 }));
    }
    await store.prepareComic(books[0].id);
    new File(extracted, String(books[0].id), 'budget-padding').write(new Uint8Array(24 * 1024));
    await store.prepareComic(books[1].id);
    new File(extracted, String(books[1].id), 'budget-padding').write(new Uint8Array(24 * 1024));
    release = store.retainComic(books[1].id);
    await store.prepareComic(books[2].id);
    const afterEvict = await store.listComics();
    checks.push({ name: 'Pressure evicts old cache, protects active reader, preserves originals', passed:
      afterEvict.find((b) => b.id === books[0].id)?.status === 'stored' &&
      !new Directory(extracted, String(books[0].id)).exists &&
      afterEvict.find((b) => b.id === books[1].id)?.status === 'ready' && original.list().length === 3 &&
      (extracted.size ?? Infinity) <= 32 * 1024 });
    await store.clearExtractedCache();
    const cleared = await store.listComics();
    checks.push({ name: 'Manual cleanup keeps active reader and removes other cache/page metadata', passed:
      cleared.find((b) => b.id === books[1].id)?.status === 'ready' &&
      cleared.find((b) => b.id === books[2].id)?.status === 'stored' && original.list().length === 3 });
    release(); release = undefined;
    await store.clearExtractedCache();
    const rebuilt = await store.openComic(books[0].id);
    checks.push({ name: 'Evicted pages and cover regenerate from original on open', passed:
      rebuilt.pages.length === 3 && rebuilt.comic.status === 'ready' && Boolean(rebuilt.comic.coverPath) &&
      (extracted.size ?? Infinity) <= 32 * 1024 && original.list().length === 3 });
    const abandoned = new Directory(extracted, '999'); abandoned.create();
    new File(abandoned, 'budget-padding').write(new Uint8Array(24 * 1024));
    await store.prepareComic(books[2].id);
    checks.push({ name: 'Uncommitted cache folders are removed before capacity accounting', passed:
      !abandoned.exists && (extracted.size ?? Infinity) <= 32 * 1024 && original.list().length === 3 });
  } finally {
    release?.(); await store.dispose(); await deleteDatabaseAsync(name);
    for (const folder of dirs) if (folder.exists) folder.delete();
  }
  const result = { platform: Platform.OS, checks, passed: checks.length === 4 && checks.every((check) => check.passed) };
  new File(Paths.document, 'cache-probe-result.json').write(JSON.stringify(result, null, 2));
  return result;
}
