import test from 'node:test';
import assert from 'node:assert/strict';
import { equalFileBytes } from '../src/utils/file-identity.ts';

test('content equality reads bounded chunks through the last byte', async () => {
  const a = new Uint8Array(200003).fill(7); let largest = 0; let reads = 0;
  const read = (offset, length) => { largest = Math.max(largest, length); reads++; return a.slice(offset, offset + length); };
  assert.equal(await equalFileBytes(a.length, read, read), true);
  assert.equal(reads, 8); assert.equal(largest, 65536);
  const b = a.slice(); b[b.length - 1] = 8;
  assert.equal(await equalFileBytes(a.length, read, (o, n) => b.slice(o, o + n)), false);
});
test('short or invalid reads fail rather than matching incomplete files', async () => {
  await assert.rejects(equalFileBytes(10, () => new Uint8Array(9), () => new Uint8Array(10)), /읽기/);
  await assert.rejects(equalFileBytes(-1, () => new Uint8Array(), () => new Uint8Array()), /Invalid/);
});
