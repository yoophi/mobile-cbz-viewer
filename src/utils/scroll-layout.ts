import type { ImageDimensions } from './image-dimensions';

export const SCROLL_LIMITS = { decodeWidth: 1280, decodeHeight: 32768, decodePixels: 16 * 1024 * 1024,
  bandHeight: 1024, maxRows: 65536, maxExtent: 16000000, pageGap: 12 } as const;
export type ReadingPosition = { index: number; fraction: number };
export type ScrollBand = { part: number; y: number; height: number };
export type ScrollRow = ScrollBand & { pageIndex: number; offset: number; length: number; imageHeight: number; known: boolean };
export type ScrollPageLayout = ImageDimensions & { firstRow: number; rowCount: number; start: number; length: number; known: boolean };
export type ScrollLayout = { rows: ScrollRow[]; pages: ScrollPageLayout[]; totalHeight: number };

function positive(value: number | null): value is number { return value !== null && Number.isSafeInteger(value) && value > 0 && value <= 1000000; }
const clamp = (value: number, max: number) => Math.max(0, Math.min(max, Number.isFinite(value) ? value : 0));

export function scrollDecodeSize({ width, height }: ImageDimensions): ImageDimensions {
  if (!positive(width) || !positive(height)) throw new Error('이미지 크기를 확인하지 못했습니다.');
  const scale = Math.min(1, SCROLL_LIMITS.decodeWidth / width, SCROLL_LIMITS.decodeHeight / height,
    Math.sqrt(SCROLL_LIMITS.decodePixels / (width * height)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

export function scrollBands(dimensions: ImageDimensions): ScrollBand[] {
  const decode = scrollDecodeSize(dimensions);
  const step = Math.max(1, Math.floor(SCROLL_LIMITS.bandHeight * dimensions.width / decode.width));
  const count = Math.ceil(dimensions.height / step);
  if (count > SCROLL_LIMITS.maxRows) throw new Error('이미지가 너무 길어 스크롤 모드에서 표시하지 못합니다.');
  return Array.from({ length: count }, (_, part) => ({ part, y: part * step, height: Math.min(step, dimensions.height - part * step) }));
}

export function buildScrollLayout(pages: { width: number | null; height: number | null }[], viewportWidth: number): ScrollLayout {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) throw new Error('화면 크기를 확인하지 못했습니다.');
  const rows: ScrollRow[] = []; const pageLayouts: ScrollPageLayout[] = [];
  let offset = 0;
  for (const [pageIndex, page] of pages.entries()) {
    const known = positive(page.width) && positive(page.height);
    const dimensions = known ? { width: page.width!, height: page.height! } : { width: 3, height: 4 };
    const bands = scrollBands(dimensions);
    if (rows.length + bands.length > SCROLL_LIMITS.maxRows) throw new Error('회차가 스크롤 표시 범위를 초과합니다. 페이지 모드를 사용해 주세요.');
    const firstRow = rows.length; const start = offset;
    for (const band of bands) {
      const imageHeight = Math.max(1, viewportWidth * band.height / dimensions.width);
      const length = imageHeight + (band.part === bands.length - 1 ? SCROLL_LIMITS.pageGap : 0);
      rows.push({ ...band, pageIndex, offset, length, imageHeight, known });
      offset += length;
    }
    if (offset > SCROLL_LIMITS.maxExtent) throw new Error('회차가 스크롤 표시 범위를 초과합니다. 페이지 모드를 사용해 주세요.');
    pageLayouts.push({ ...dimensions, known, firstRow, rowCount: bands.length, start, length: offset - start });
  }
  return { rows, pages: pageLayouts, totalHeight: offset };
}

export function scrollRowAtOffset(layout: ScrollLayout, offset: number) {
  if (!layout.rows.length) return 0;
  const value = clamp(offset, layout.totalHeight);
  let low = 0; let high = layout.rows.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (layout.rows[middle].offset <= value) low = middle; else high = middle - 1;
  }
  return low;
}

export function scrollPositionAtOffset(layout: ScrollLayout, offset: number): ReadingPosition {
  const index = scrollRowAtOffset(layout, offset);
  const next = layout.rows[index + 1];
  // Native scroll offsets are rounded to display pixels. A sub-pixel difference
  // at a page anchor must not report the preceding page's trailing gap.
  const row = next && next.offset - offset >= 0 && next.offset - offset < 0.5 ? next : layout.rows[index];
  if (!row) return { index: 0, fraction: 0 };
  const within = clamp(offset - row.offset, row.imageHeight) / row.imageHeight;
  return { index: row.pageIndex, fraction: (row.y + within * row.height) / layout.pages[row.pageIndex].height };
}

export function scrollOffsetAtPosition(layout: ScrollLayout, position: ReadingPosition): number {
  const page = layout.pages[Math.floor(clamp(position.index, layout.pages.length - 1))];
  if (!page) return 0;
  const y = clamp(position.fraction, 1) * page.height;
  let row = layout.rows[page.firstRow + page.rowCount - 1];
  for (let index = page.firstRow; index < page.firstRow + page.rowCount; index++) {
    const candidate = layout.rows[index];
    if (y < candidate.y + candidate.height) { row = candidate; break; }
  }
  return row.offset + clamp(y - row.y, row.height) / row.height * row.imageHeight;
}
