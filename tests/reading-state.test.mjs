import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadingWriter, normalizeReadingState } from '../src/utils/reading-state.ts';

const state = (index, fraction = 0) => ({ index, fraction, mode: 'scroll', direction: 'rtl' });
const tick = () => new Promise(resolve => setImmediate(resolve));
function clock() {
  let time = 0, next = 0;
  const timers = new Map();
  return { now: () => time, setTimer: (callback, delay) => { const key = ++next; timers.set(key, { at: time + delay, callback }); return key; },
    clearTimer: key => timers.delete(key), advance: async ms => {
      time += ms;
      for (const [key, timer] of [...timers]) if (timer.at <= time) { timers.delete(key); timer.callback(); }
      await tick();
    } };
}
test('restore clamps changed page counts, malformed positions and unknown settings', () => {
  assert.deepEqual(normalizeReadingState(state(8, .75), 4), state(3, 0));
  assert.deepEqual(normalizeReadingState(state(2, 4), 4), state(2, 1));
  assert.deepEqual(normalizeReadingState(state(2, NaN), 4), state(2));
  assert.deepEqual(normalizeReadingState({ index: -1, fraction: .5, mode: 'other', direction: 'other' }, 4), { index: 0, fraction: 0, mode: 'page', direction: 'ltr' });
  assert.deepEqual(normalizeReadingState(state(0, .5), 0), state(0));
});
test('rapid scroll updates write only the newest value at the interval; lifecycle flush bypasses it', async () => {
  const time = clock(), writes = [];
  const writer = createReadingWriter(async value => { writes.push(value); }, assert.fail, time);
  writer.update(state(0)); await time.advance(0);
  for (let i = 1; i <= 100; i++) { writer.update(state(i)); await time.advance(5); }
  assert.equal(writes.length, 1);
  await time.advance(500); assert.deepEqual(writes.at(-1), state(100));
  writer.update(state(101, .5)); await writer.flush();
  assert.deepEqual(writes.at(-1), state(101, .5));
  await writer.dispose();
  await time.advance(5000); assert.equal(writes.length, 3);
});
test('a lifecycle flush waits for in-flight writes and then commits the newest revision in order', async () => {
  const time = clock(), writes = []; let release;
  const writer = createReadingWriter(async value => {
    writes.push(value);
    if (writes.length === 1) await new Promise(resolve => { release = resolve; });
  }, assert.fail, time);
  writer.update(state(1)); await time.advance(0);
  writer.update(state(2)); writer.update(state(3));
  const flushed = writer.flush(); release(); await flushed;
  assert.deepEqual(writes, [state(1), state(3)]);
  await writer.dispose();
});
test('write failure is reported, retained for retry and does not create an automatic retry loop', async () => {
  const time = clock(), errors = []; let failing = true, writes = 0;
  const writer = createReadingWriter(async () => { writes++; if (failing) throw new Error('disk unavailable'); }, error => errors.push(error), time);
  writer.update(state(2)); await time.advance(0);
  assert.equal(errors.length, 1);
  await time.advance(5000); assert.equal(writes, 1);
  await assert.rejects(writer.flush()); assert.equal(errors.length, 2);
  failing = false; await writer.flush(); assert.equal(writes, 3);
  await writer.dispose();
});
