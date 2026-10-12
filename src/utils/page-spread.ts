import type { PageAction, ReadingDirection } from './reader-navigation';

export const SPREAD_GAP = 0;
export const MIN_SPREAD_WIDTH = 2 * 360;
export type PageLayout = 'single' | 'double' | 'auto';

// Fit both source aspect ratios as one touching spread at the same height.
export function fitPageSpread(width: number, height: number, pages: { width?: number | null; height?: number | null }[]) {
  const ratios = pages.map((page) => page.width && page.height && page.width > 0 && page.height > 0
    ? page.width / page.height : 1);
  const totalRatio = ratios.reduce((sum, ratio) => sum + ratio, 0);
  const fittedHeight = totalRatio > 0 ? Math.max(0, Math.min(height, width / totalRatio)) : 0;
  return { height: fittedHeight, widths: ratios.map((ratio) => ratio * fittedHeight), width: totalRatio * fittedHeight };
}

// Keep the reading anchor unchanged: a spread is only a view of that anchor.
// Cover 0 stands alone; body pairs are (1,2), (3,4), ... in source order.
export function pageSpread(index: number, count: number, width: number, direction: ReadingDirection, layout: PageLayout = 'auto') {
  if (!Number.isSafeInteger(count) || count < 1) return undefined;
  const anchor = Math.max(0, Math.min(count - 1, Number.isSafeInteger(index) ? index : 0));
  const wide = layout === 'double' || (layout === 'auto' && Number.isFinite(width) && width >= MIN_SPREAD_WIDTH);
  const first = wide && anchor > 0 ? 1 + 2 * Math.floor((anchor - 1) / 2) : anchor;
  const last = wide && first > 0 ? Math.min(count - 1, first + 1) : first;
  const indices = first === last ? [first] : direction === 'ltr' ? [first, last] : [last, first];
  return { anchor, first, last, indices, wide };
}

export function spreadPageAfter(index: number, count: number, width: number, action: PageAction, layout: PageLayout = 'auto') {
  const spread = pageSpread(index, count, width, 'ltr', layout);
  if (!spread) return 0;
  return action === 'next' ? Math.min(count - 1, spread.last + 1)
    : Math.max(0, spread.first - (spread.wide ? 2 : 1));
}
