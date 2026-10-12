import { Directory, File, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { ComicPage } from './library';
import { checkCancelled } from '@/utils/zip-validation';
import { scrollBands, scrollDecodeSize } from '@/utils/scroll-layout';

export const SCROLL_CACHE_BYTES = 128 * 1024 * 1024;
type BandFiles = { uris: string[] };
type Manifest = { version: number; path: string; size: number; width: number; height: number; count: number };
type Job = { controller: AbortController; promise: Promise<BandFiles>; references: number; settled: boolean };

// One source page is decoded at a time. Leases protect only pages near the viewport,
// so a long open book cannot pin every derived image in memory or on disk.
export function createScrollCache(root: () => Directory, staging: () => Directory,
  exclusive: <T>(work: () => Promise<T>) => Promise<T>, reserve: (id: number, bytes: number) => Promise<void>) {
  const jobs = new Map<string, Job>();
  const pins = new Map<string, number>();
  let queue: Promise<unknown> = Promise.resolve();
  const keyFor = (page: ComicPage) => `${page.comicId}/${page.position}`;
  const folderFor = (page: ComicPage) => new Directory(root(), String(page.comicId), 'scroll', String(page.position));

  function trim(incoming: number) {
    const entries: { key: string; folder: Directory; bytes: number; time: number }[] = [];
    if (root().exists) for (const book of root().list()) {
      if (!(book instanceof Directory) || !/^\d+$/.test(book.name)) continue;
      const scroll = new Directory(book, 'scroll');
      if (!scroll.exists) continue;
      for (const folder of scroll.list()) if (folder instanceof Directory && /^\d+$/.test(folder.name)) {
        const bytes = folder.size;
        if (bytes === null) throw new Error('스크롤 캐시 용량을 확인하지 못했습니다.');
        entries.push({ key: `${book.name}/${folder.name}`, folder, bytes, time: new File(folder, 'manifest.json').modificationTime ?? 0 });
      }
    }
    let total = entries.reduce((sum, entry) => sum + entry.bytes, 0) + incoming;
    for (const entry of entries.sort((a, b) => a.time - b.time)) {
      if (total <= SCROLL_CACHE_BYTES) break;
      if (!pins.has(entry.key)) { entry.folder.delete(); total -= entry.bytes; }
    }
    if (total > SCROLL_CACHE_BYTES) throw new Error('스크롤 캐시 공간이 부족합니다. 페이지 모드를 사용해 주세요.');
  }

  async function build(page: ComicPage, signal: AbortSignal): Promise<BandFiles> {
    checkCancelled(signal);
    if (!page.width || !page.height) throw new Error('이미지 크기를 확인하지 못했습니다. 원본에서 복구하거나 페이지 모드를 사용해 주세요.');
    if (page.width * page.height > 128 * 1024 * 1024) throw new Error('이미지 해상도가 스크롤 처리 범위를 초과합니다.');
    const dimensions = { width: page.width, height: page.height };
    const bands = scrollBands(dimensions);
    const final = folderFor(page);
    const expected: Manifest = { version: 1, path: page.path, size: page.size, ...dimensions, count: bands.length };
    const manifest = new File(final, 'manifest.json');
    const files = bands.map(({ part }) => new File(final, `${part}.png`));
    if (manifest.exists) {
      try {
        if (JSON.stringify(JSON.parse(await manifest.text())) === JSON.stringify(expected) && files.every((file) => file.exists && file.size > 0)) {
          checkCancelled(signal);
          manifest.write(JSON.stringify(expected));
          return { uris: files.map((file) => file.uri) };
        }
      } catch { checkCancelled(signal); /* Missing/corrupt cache is regenerated from the retained source. */ }
    }
    return exclusive(async () => {
      checkCancelled(signal);
      const source = new File(page.uri);
      if (!source.exists || source.size !== page.size) throw new Error('추출된 이미지가 없습니다. 원본에서 페이지를 복구해 주세요.');
      if (final.exists) final.delete();
      const decode = scrollDecodeSize(dimensions);
      // PNG worst-case pixel bytes plus filter/deflate overhead; actual bytes checked again.
      const reservation = decode.width * decode.height * 4 + bands.length * 32768 + 131072;
      trim(reservation);
      await reserve(page.comicId, reservation);
      checkCancelled(signal);
      if (Paths.availableDiskSpace < reservation + 32 * 1024 * 1024) throw new Error('스크롤 이미지를 준비할 저장 공간이 부족합니다.');
      const stage = new Directory(staging(), String(page.comicId), String(page.position));
      if (stage.exists) stage.delete();
      stage.create({ intermediates: true });
      let loaded: Awaited<ReturnType<typeof Image.loadAsync>> | undefined;
      let base: Awaited<ReturnType<ReturnType<typeof ImageManipulator.manipulate>['renderAsync']>> | undefined;
      let context: ReturnType<typeof ImageManipulator.manipulate> | undefined;
      let published = false;
      try {
        loaded = await Image.loadAsync(page.uri, { maxWidth: decode.width, maxHeight: decode.height });
        checkCancelled(signal);
        context = ImageManipulator.manipulate(loaded);
        base = await context.renderAsync();
        context.release(); context = undefined;
        loaded.release(); loaded = undefined;
        if (base.width * base.height > 16 * 1024 * 1024 || base.width > 1280 || base.height > 32768) throw new Error('이미지를 안전한 크기로 줄이지 못했습니다.');
        for (const band of bands) {
          checkCancelled(signal);
          const start = Math.round(band.y / dimensions.height * base.height);
          const end = Math.round((band.y + band.height) / dimensions.height * base.height);
          if (end <= start) throw new Error('이미지를 스크롤 구간으로 나누지 못했습니다.');
          const crop = ImageManipulator.manipulate(base).crop({ originX: 0, originY: start, width: base.width, height: end - start });
          let pixels: typeof base | undefined; let saved: File | undefined;
          try {
            pixels = await crop.renderAsync();
            const result = await pixels.saveAsync({ format: SaveFormat.PNG });
            saved = new File(result.uri);
            checkCancelled(signal);
            await saved.copy(new File(stage, `${band.part}.png`));
          } finally { if (saved?.exists) saved.delete(); pixels?.release(); crop.release(); }
        }
        checkCancelled(signal);
        new File(stage, 'manifest.json').write(JSON.stringify(expected));
        const bytes = stage.size;
        if (bytes === null || bytes > reservation) throw new Error('스크롤 캐시가 예상 용량을 초과했습니다.');
        trim(bytes);
        await reserve(page.comicId, bytes);
        checkCancelled(signal);
        new Directory(root(), String(page.comicId), 'scroll').create({ intermediates: true, idempotent: true });
        await stage.move(final);
        published = true;
        return { uris: files.map((file) => file.uri) };
      } finally {
        base?.release(); context?.release(); loaded?.release();
        if (!published && stage.exists) stage.delete();
        if (!await Image.clearDiskCache()) throw new Error('네이티브 이미지 캐시를 정리하지 못했습니다.');
        if (!await Image.clearMemoryCache()) throw new Error('네이티브 이미지 메모리 캐시를 정리하지 못했습니다.');
      }
    });
  }

  function acquire(page: ComicPage) {
    const key = keyFor(page);
    pins.set(key, (pins.get(key) ?? 0) + 1);
    let job = jobs.get(key);
    if (!job || job.controller.signal.aborted) {
      const controller = new AbortController();
      const promise = queue.catch(() => {}).then(() => build(page, controller.signal));
      job = { controller, promise, references: 0, settled: false };
      jobs.set(key, job);
      const current = job;
      queue = promise.then(() => {}, () => {}).finally(() => {
        current.settled = true;
        if (jobs.get(key) === current) jobs.delete(key);
      });
    }
    job.references++;
    const current = job; let released = false;
    return { promise: job.promise, release() {
      if (released) return;
      released = true;
      const count = (pins.get(key) ?? 1) - 1;
      if (count) pins.set(key, count); else pins.delete(key);
      if (--current.references === 0 && !current.settled) current.controller.abort();
    } };
  }
  async function stop() { for (const job of jobs.values()) job.controller.abort(); await queue; }
  function recover() { if (staging().exists) staging().delete(); trim(0); }
  return { acquire, stop, recover };
}
