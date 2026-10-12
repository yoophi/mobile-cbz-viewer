import assert from 'node:assert/strict';
import { test } from 'node:test';
import { zipSync } from 'fflate';
import { inspectArchive, verifyArchiveImages, ZIP_LIMITS } from '../src/utils/zip-validation.ts';
import { fixtureBytes, imageBytes } from '../src/diagnostics/zip-fixture.ts';

const read = (bytes) => (offset, length) => bytes.subarray(offset, offset + length);
const inspect = (bytes) => inspectArchive(bytes.length, read(bytes));
function zip(files) { return zipSync(files, { level: 6, mtime: new Date('2026-01-01') }); }
function centralOffset(bytes) { return new DataView(bytes.buffer, bytes.byteOffset).getUint32(bytes.length - 6, true); }
function mutate(bytes, offset, value, width = 4) {
  const result = bytes.slice();
  const data = new DataView(result.buffer);
  width === 2 ? data.setUint16(offset, value, true) : data.setUint32(offset, value, true);
  return result;
}

test('Unicode/nested PNGs pass with non-images excluded from extraction', async () => {
  const entries = inspect(fixtureBytes);
  assert.equal(entries.filter((item) => item.image).length, 3);
  assert.equal(entries.find((item) => item.path === 'notes.txt').image, false);
  await verifyArchiveImages(entries, read(fixtureBytes));
});

for (const path of ['../escape.png', '/escape.png', 'a/../../escape.png', 'a\\escape.png', 'C:/escape.png', '%2e%2e/escape.png', 'a//escape.png', 'a/./escape.png']) {
  test(`rejects hostile path ${path}`, () => assert.throws(() => inspect(zip({ [path]: imageBytes })), /경로/));
}

test('rejects symlinks before disk extraction', () => {
  const bytes = zip({ 'link.png': [imageBytes, { os: 3, attrs: 0o120777 << 16 }] });
  assert.throws(() => inspect(bytes), /심볼릭/);
});

test('rejects case/Unicode aliases and file-directory conflicts', () => {
  for (const files of [
    { 'A.png': imageBytes, 'a.png': imageBytes },
    { 'é.png': imageBytes, 'e\u0301.png': imageBytes },
    { 'a.png': imageBytes, 'a.png/2.png': imageBytes },
  ]) assert.throws(() => inspect(zip(files)), /충돌/);
});

test('rejects empty, corrupt, truncated and imageless archives', () => {
  for (const bytes of [new Uint8Array(), fixtureBytes.slice(0, 40), zip({}), zip({ 'notes.txt': imageBytes })]) {
    assert.throws(() => inspect(bytes));
  }
});

test('rejects excessive archive, entry count and advertised expansion', () => {
  assert.throws(() => inspectArchive(ZIP_LIMITS.archiveBytes + 1, () => { throw Error('must not read'); }), /512/);
  assert.throws(() => inspect(mutate(fixtureBytes, fixtureBytes.length - 12, ZIP_LIMITS.entries + 1, 2)));
  const offset = centralOffset(fixtureBytes);
  assert.throws(() => inspect(mutate(fixtureBytes, offset + 24, ZIP_LIMITS.imageBytes + 1)), /크기/);
  assert.throws(() => inspect(zip({ 'bomb.png': new Uint8Array(1024 * 1024) })), /압축률/);
});

test('rejects encryption, ZIP64 and mismatched local paths', () => {
  const offset = centralOffset(fixtureBytes);
  assert.throws(() => inspect(mutate(fixtureBytes, offset + 8, 1, 2)), /암호화/);
  assert.throws(() => inspect(mutate(fixtureBytes, fixtureBytes.length - 6, 0xffffffff)), /ZIP64/);
  const bytes = fixtureBytes.slice();
  bytes[30] = 50;
  assert.throws(() => inspect(bytes), /일치/);
});

test('actual output and CRC are verified even with forged advertised sizes', async () => {
  const bytes = zip({ '1.png': imageBytes });
  const offset = centralOffset(bytes);
  const forged = mutate(mutate(bytes, offset + 24, 1), 22, 1);
  const entries = inspect(forged);
  await assert.rejects(verifyArchiveImages(entries, read(forged)), /실제/);
  const badCrc = mutate(mutate(bytes, offset + 16, 1), 14, 1);
  await assert.rejects(verifyArchiveImages(inspect(badCrc), read(badCrc)), /손상/);
});

test('rejects mislabeled image data and aborts before reading payload', async () => {
  const bytes = zip({ '1.png': new Uint8Array([1, 2, 3]) });
  await assert.rejects(verifyArchiveImages(inspect(bytes), read(bytes)), /형식/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(verifyArchiveImages(inspect(fixtureBytes), () => { throw Error('must not read'); }, controller.signal), /취소/);
});

test('supports stored entries and descriptor-based Deflate records', async () => {
  const stored = zipSync({ '1.png': imageBytes }, { level: 0 });
  await verifyArchiveImages(inspect(stored), read(stored));
  const bytes = zip({ '1.png': imageBytes });
  const offset = centralOffset(bytes);
  const descriptor = new Uint8Array(bytes.length + 16);
  descriptor.set(bytes.subarray(0, offset));
  descriptor.set(bytes.subarray(offset), offset + 16);
  const data = new DataView(descriptor.buffer);
  const original = new DataView(bytes.buffer);
  data.setUint32(offset, 0x08074b50, true);
  for (let index = 0; index < 3; index++) data.setUint32(offset + 4 + index * 4, original.getUint32(14 + index * 4, true), true);
  data.setUint16(6, 8, true);
  data.setUint16(offset + 16 + 8, 8, true);
  data.setUint32(descriptor.length - 6, offset + 16, true);
  await verifyArchiveImages(inspect(descriptor), read(descriptor));
  assert.throws(() => inspect(mutate(mutate(bytes, offset + 8, 8, 2), 6, 8, 2)));
});
