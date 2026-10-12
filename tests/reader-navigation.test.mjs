import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseComicId, pageAfter, physicalPageAction } from '../src/utils/reader-navigation.ts';

test('only positive safe scalar route ids are accepted', () => {
  for (const value of [undefined, ['1'], '', '0', '-1', '1.5', '1e2', '01', '../1', 'Infinity', '9007199254740992']) assert.equal(parseComicId(value), undefined);
  assert.equal(parseComicId('12'), 12);
});
test('first and last boundaries work for both physical reading directions', () => {
  for (const direction of ['ltr', 'rtl']) {
    const next = physicalPageAction(direction === 'ltr' ? 'right' : 'left', direction);
    const previous = physicalPageAction(direction === 'ltr' ? 'left' : 'right', direction);
    assert.equal(next, 'next'); assert.equal(previous, 'previous');
    assert.equal(pageAfter(0, 3, previous), 0);
    assert.equal(pageAfter(0, 3, next), 1);
    assert.equal(pageAfter(2, 3, next), 2);
    assert.equal(pageAfter(2, 3, previous), 1);
    assert.equal(pageAfter(0, 1, next), 0);
    assert.equal(pageAfter(0, 0, previous), 0);
  }
});
