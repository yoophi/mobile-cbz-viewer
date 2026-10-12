import test from 'node:test';
import assert from 'node:assert/strict';
import { readImageDimensions } from '../src/utils/image-dimensions.ts';
import { imageBytes } from '../src/diagnostics/zip-fixture.ts';

function dimensions(data) {
  let readBytes = 0;
  const result = readImageDimensions(data.length, (offset, count) => {
    assert.ok(offset >= 0 && offset + count <= data.length);
    readBytes += count;
    return data.slice(offset, offset + count);
  });
  return { result, readBytes };
}
function jpeg(orientation, little) {
  const exif = new Uint8Array(32);
  exif.set([69, 120, 105, 102, 0, 0]);
  const v = new DataView(exif.buffer);
  exif.set(little ? [73, 73] : [77, 77], 6);
  v.setUint16(8, 42, little); v.setUint32(10, 8, little);
  v.setUint16(14, 1, little); v.setUint16(16, 274, little); v.setUint16(18, 3, little);
  v.setUint32(20, 1, little); v.setUint16(24, orientation, little);
  const app = [255, 225, 0, exif.length + 2, ...exif];
  return new Uint8Array([255, 216, ...app, 255, 194, 0, 11, 8, 0, 30, 0, 20, 1, 1, 17, 0, 255, 218, 0, 2]);
}
test('PNG dimensions are read without decoding image payload', () => {
  assert.deepEqual(dimensions(imageBytes).result, { width: 1, height: 1 });
  const zero = imageBytes.slice(); zero.fill(0, 16, 20);
  assert.equal(dimensions(zero).result, undefined);
  assert.equal(dimensions(imageBytes.slice(0, 20)).result, undefined);
});
test('JPEG progressive SOF and EXIF rotation/mirroring are handled in both byte orders', () => {
  for (const little of [true, false]) for (let orientation = 1; orientation <= 8; orientation++) {
    assert.deepEqual(dimensions(jpeg(orientation, little)).result,
      orientation < 5 ? { width: 20, height: 30 } : { width: 30, height: 20 });
  }
});
test('JPEG seeks past large APP payloads and rejects malformed segment bounds', () => {
  const image = new Uint8Array(60000 + jpeg(1, true).length);
  image.set([255, 216, 255, 226, 234, 94]); // APP2 length 59998; next marker at 60002.
  image.set(jpeg(1, true).slice(2), 60002);
  const parsed = dimensions(image);
  assert.deepEqual(parsed.result, { width: 20, height: 30 });
  assert.ok(parsed.readBytes < 150);
  assert.equal(dimensions(new Uint8Array([255, 216, 255, 225, 255, 255])).result, undefined);
});
test('extended, lossy and lossless WebP dimensions are parsed with bounded chunks', () => {
  const riff = (kind, data) => {
    const bytes = new Uint8Array(20 + data.length + (data.length & 1));
    bytes.set([...Buffer.from('RIFF')], 0); bytes.set([...Buffer.from('WEBP' + kind)], 8);
    const view = new DataView(bytes.buffer); view.setUint32(4, bytes.length - 8, true); view.setUint32(16, data.length, true);
    bytes.set(data, 20); return bytes;
  };
  assert.deepEqual(dimensions(riff('VP8X', [0, 0, 0, 0, 19, 0, 0, 29, 0, 0])).result, { width: 20, height: 30 });
  assert.deepEqual(dimensions(riff('VP8 ', [0, 0, 0, 157, 1, 42, 20, 0, 30, 0])).result, { width: 20, height: 30 });
  assert.deepEqual(dimensions(riff('VP8L', [47, 19, 64, 7, 0])).result, { width: 20, height: 30 });
  assert.equal(dimensions(riff('VP8X', [0])).result, undefined);
});
