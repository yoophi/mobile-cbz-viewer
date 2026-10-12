import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comparePagePaths, isVisibleImagePath } from '../src/utils/page-order.ts';

test('natural numbers including arbitrarily large values and leading zeros', () => {
  assert.deepEqual(['10.jpg', '002.jpg', '1.jpg', '2.jpg', '999999999999999999999.jpg', '1000000000000000000000.jpg'].sort(comparePagePaths),
    ['1.jpg', '2.jpg', '002.jpg', '10.jpg', '999999999999999999999.jpg', '1000000000000000000000.jpg']);
});
test('directory components are sorted naturally with Korean paths and stable case ties', () => {
  const paths = ['한글/10.PNG', '권10/1.jpg', '권2/10.jpg', '권2/2.jpg', '한글/2.png', 'a10.jpg', 'A2.jpg'];
  assert.deepEqual(paths.sort(comparePagePaths), ['A2.jpg', 'a10.jpg', '권2/2.jpg', '권2/10.jpg', '권10/1.jpg', '한글/2.png', '한글/10.PNG']);
  assert.deepEqual(['a1.jpg', 'A1.jpg'].sort(comparePagePaths), ['A1.jpg', 'a1.jpg']);
});
test('order does not depend on insertion order and comparator is antisymmetric', () => {
  const paths = ['권2/02.jpg', '권2/2.jpg', '권10/1.jpg', '1.jpg', 'é/1.png', 'e\u0301/2.png'];
  assert.deepEqual([...paths].sort(comparePagePaths), [...paths].reverse().sort(comparePagePaths));
  for (const a of paths) for (const b of paths) assert.equal(Math.sign(comparePagePaths(a, b)) + Math.sign(comparePagePaths(b, a)), 0);
});
test('hidden files, metadata directories and non-images are excluded', () => {
  for (const path of ['.1.png', 'a/.hidden/1.jpg', '__MACOSX/1.jpg', 'notes.txt', '1.png/']) assert.equal(isVisibleImagePath(path), false);
  for (const path of ['한글/1.JPG', '1.jpeg', '2.PNG', '10.webp']) assert.equal(isVisibleImagePath(path), true);
});
