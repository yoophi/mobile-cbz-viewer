export type ReadingDirection = 'ltr' | 'rtl';
export type PageAction = 'previous' | 'next';

export function parseComicId(value: string | string[] | undefined) {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : undefined;
}

export function pageAfter(index: number, count: number, action: PageAction) {
  return Math.max(0, Math.min(Math.max(0, count - 1), index + (action === 'next' ? 1 : -1)));
}

export function physicalPageAction(side: 'left' | 'right', direction: ReadingDirection): PageAction {
  return (side === 'right') === (direction === 'ltr') ? 'next' : 'previous';
}
