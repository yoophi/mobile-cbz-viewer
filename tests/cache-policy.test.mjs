import test from 'node:test';
import assert from 'node:assert/strict';
import { selectCacheEvictions } from '../src/utils/cache-policy.ts';

const limits = { extractedBytes: 100, coverBytes: 10, bookOverheadBytes: 0 };
const entry = (id, bytes, lastAccess, coverBytes = 1) => ({ id, bytes, lastAccess, coverBytes });
test('LRU evicts enough old caches for incoming data without mutating metadata', () => {
  const entries = [entry(1, 40, 3), entry(2, 30, 1), entry(3, 20, 2)];
  assert.deepEqual(selectCacheEvictions(entries, new Set(), 40, 1, limits), [2]);
  assert.deepEqual(entries.map(x => x.id), [1, 2, 3]);
  assert.deepEqual(selectCacheEvictions(entries, new Set([2]), 40, 1, limits), [3, 1]);
});
test('cover budget and deterministic ties are enforced independently', () => {
  assert.deepEqual(selectCacheEvictions([entry(2, 5, 1, 6), entry(1, 5, 1, 6)], new Set(), 0, 0, limits), [1]);
  assert.deepEqual(selectCacheEvictions([entry(1, 100, 1, 10)], new Set([1]), 0, 0, limits), []);
});
test('oversized incoming data and protected caches cannot silently exceed budgets', () => {
  assert.throws(() => selectCacheEvictions([], new Set(), 101, 0, limits));
  assert.throws(() => selectCacheEvictions([entry(1, 90, 1)], new Set([1]), 20, 0, limits));
});
