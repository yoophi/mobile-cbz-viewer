import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScrollLayout, scrollBands, scrollDecodeSize, scrollOffsetAtPosition, scrollPositionAtOffset, SCROLL_LIMITS } from '../src/utils/scroll-layout.ts';

const pages = [{ width: 2048, height: 3072 }, { width: 3, height: 2 }, { width: 512, height: 30000 }];
test('mixed ratios and long strips have complete contiguous bands and fixed geometry', () => {
  const layout = buildScrollLayout(pages, 400);
  assert.equal(layout.pages.length, 3);
  assert.equal(layout.pages[2].rowCount, 30);
  for (const [index, page] of layout.pages.entries()) {
    const bands = layout.rows.slice(page.firstRow, page.firstRow + page.rowCount);
    assert.equal(bands.reduce((sum, band) => sum + band.height, 0), pages[index].height);
    assert.equal(bands[0].y, 0);
    for (let i = 1; i < bands.length; i++) assert.equal(bands[i].y, bands[i - 1].y + bands[i - 1].height);
  }
  assert.equal(layout.totalHeight, layout.rows.reduce((sum, row) => sum + row.length, 0));
});
test('page/fraction anchors round trip and preserve position at different widths', () => {
  for (const width of [320, 800, 1200]) {
    const layout = buildScrollLayout(pages, width);
    for (let index = 0; index < pages.length; index++) for (const fraction of [0, 0.01, 0.5, 0.99, 1]) {
      const actual = scrollPositionAtOffset(layout, scrollOffsetAtPosition(layout, { index, fraction }));
      assert.equal(actual.index, index);
      assert.ok(Math.abs(actual.fraction - fraction) < 1e-10);
    }
  }
});
test('decode limits constrain varied source sizes without upscaling small images', () => {
  for (const source of [...pages, { width: 1000000, height: 1000000 }, { width: 10, height: 10 }]) {
    const target = scrollDecodeSize(source);
    assert.ok(target.width <= SCROLL_LIMITS.decodeWidth && target.height <= SCROLL_LIMITS.decodeHeight);
    assert.ok(target.width * target.height <= SCROLL_LIMITS.decodePixels);
    assert.ok(target.width <= source.width && target.height <= source.height);
  }
  assert.deepEqual(scrollBands({ width: 512, height: 30000 }).at(-1), { part: 29, y: 29696, height: 304 });
});
test('native sub-pixel offset rounding does not move a page anchor into the previous gap', () => {
  const layout = buildScrollLayout(pages, 411.428571);
  for (let index = 1; index < pages.length; index++) {
    const offset = scrollOffsetAtPosition(layout, { index, fraction: 0 });
    assert.deepEqual(scrollPositionAtOffset(layout, offset - 0.001), { index, fraction: 0 });
  }
});
test('unknown metadata has stable placeholders and malformed geometry is bounded', () => {
  assert.equal(buildScrollLayout([{ width: null, height: null }], 400).rows[0].known, false);
  assert.throws(() => buildScrollLayout(pages, 0));
  assert.throws(() => buildScrollLayout([{ width: 1, height: 1000000 }], 400));
  assert.deepEqual(scrollPositionAtOffset(buildScrollLayout([], 400), 100), { index: 0, fraction: 0 });
});
