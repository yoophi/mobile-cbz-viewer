import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitPageSpread, MIN_SPREAD_WIDTH, pageSpread, spreadPageAfter } from '../src/utils/page-spread.ts';

test('cover is alone and body pairs reverse visual order for RTL', () => {
  for (const direction of ['ltr', 'rtl']) {
    assert.deepEqual(pageSpread(0, 5, 900, direction).indices, [0]);
    assert.deepEqual(pageSpread(1, 5, 900, direction).indices, direction === 'ltr' ? [1, 2] : [2, 1]);
    assert.deepEqual(pageSpread(2, 5, 900, direction).indices, direction === 'ltr' ? [1, 2] : [2, 1]);
    assert.deepEqual(pageSpread(4, 5, 900, direction).indices, direction === 'ltr' ? [3, 4] : [4, 3]);
    assert.deepEqual(pageSpread(3, 4, 900, direction).indices, [3]);
  }
});

test('size changes alter visible pages without changing the saved anchor', () => {
  for (let count = 1; count <= 20; count++) for (let index = 0; index < count; index++) {
    for (const width of [320, MIN_SPREAD_WIDTH - 1, MIN_SPREAD_WIDTH, 1400, 400]) {
      const span = pageSpread(index, count, width, 'rtl');
      assert.equal(span.anchor, index);
      assert.ok(span.indices.includes(index));
      assert.equal(new Set(span.indices).size, span.indices.length);
      assert.ok(span.indices.every(page => page >= 0 && page < count));
      if (width < MIN_SPREAD_WIDTH) assert.deepEqual(span.indices, [index]);
    }
  }
});

test('forward and backward spread traversal has no omitted or duplicate pages', () => {
  for (let count = 1; count <= 101; count++) for (const width of [400, 900]) for (const direction of ['ltr', 'rtl']) {
    const seen = [];
    let index = 0;
    for (;;) {
      const span = pageSpread(index, count, width, direction);
      seen.push(...(direction === 'rtl' ? [...span.indices].reverse() : span.indices));
      if (span.last === count - 1) break;
      const next = spreadPageAfter(index, count, width, 'next');
      assert.ok(next > index);
      assert.equal(spreadPageAfter(next, count, width, 'previous'), index);
      index = next;
    }
    assert.deepEqual(seen, Array.from({ length: count }, (_, i) => i));
    assert.equal(spreadPageAfter(0, count, width, 'previous'), 0);
    assert.equal(spreadPageAfter(count - 1, count, width, 'next'), count - 1);
  }
});

test('navigation from a restored second page skips the whole visible spread', () => {
  assert.equal(spreadPageAfter(2, 8, 900, 'previous'), 0);
  assert.equal(spreadPageAfter(2, 8, 900, 'next'), 3);
  assert.equal(spreadPageAfter(4, 8, 900, 'previous'), 1);
  assert.equal(spreadPageAfter(4, 8, 400, 'previous'), 3);
  assert.equal(pageSpread(0, 0, 900, 'ltr'), undefined);
  assert.equal(pageSpread(2, 8, NaN, 'ltr').wide, false);
});

test('explicit one/two page selection overrides window width without changing the source anchor', () => {
  for (const layout of ['single', 'double']) for (const width of [320, 900]) for (const direction of ['ltr', 'rtl']) {
    for (let count = 1; count <= 80; count++) {
      const seen = [];
      let index = 0;
      for (;;) {
        const spread = pageSpread(index, count, width, direction, layout);
        assert.equal(spread.anchor, index);
        assert.equal(spread.wide, layout === 'double');
        if (layout === 'single') assert.deepEqual(spread.indices, [index]);
        seen.push(...[...spread.indices].sort((a, b) => a - b));
        if (spread.last === count - 1) break;
        const next = spreadPageAfter(index, count, width, 'next', layout);
        assert.equal(spreadPageAfter(next, count, width, 'previous', layout), index);
        index = next;
      }
      assert.deepEqual(seen, Array.from({ length: count }, (_, i) => i));
      for (let anchor = 0; anchor < count; anchor++) {
        assert.equal(pageSpread(anchor, count, width, direction, layout).anchor, anchor);
        assert.ok(pageSpread(anchor, count, width, direction, layout).indices.includes(anchor));
      }
    }
  }
});

test('touching spreads fit mixed aspect ratios at the maximum common height', () => {
  for (const [width, height] of [[393, 800], [992, 1200], [1200, 500]]) {
    for (const pages of [[{ width: 600, height: 900 }, { width: 600, height: 900 }],
      [{ width: 1400, height: 900 }, { width: 600, height: 1200 }]]) {
      const fit = fitPageSpread(width, height, pages);
      assert.ok(Math.abs(fit.widths.reduce((a, b) => a + b, 0) - fit.width) < .000001);
      assert.ok(fit.width <= width + .000001 && fit.height <= height + .000001);
      assert.ok(Math.abs(fit.width - width) < .000001 || Math.abs(fit.height - height) < .000001);
      fit.widths.forEach((pageWidth, index) => assert.ok(Math.abs(pageWidth / fit.height - pages[index].width / pages[index].height) < .000001));
    }
  }
});
