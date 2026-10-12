import test from 'node:test';
import assert from 'node:assert/strict';
import { boundZoom, containSize, focalZoom, IDENTITY_ZOOM } from '../src/utils/zoom.ts';

test('contain geometry keeps letterbox axes centred until scaled content exceeds viewport', () => {
  const viewport = { width: 400, height: 800 };
  const content = containSize(viewport, { width: 1000, height: 1000 });
  assert.deepEqual(content, { width: 400, height: 400 });
  assert.deepEqual(boundZoom({ scale: 1.5, x: 999, y: -999 }, viewport, content), { scale: 1.5, x: 100, y: -0 });
  assert.deepEqual(boundZoom({ scale: 20, x: -9999, y: 9999 }, viewport, content), { scale: 4, x: -600, y: 400 });
  assert.equal(boundZoom({ scale: 0.1, x: 20, y: 20 }, viewport, content).scale, 1);
});
test('focal point remains on the same source pixel during pinch and centroid movement', () => {
  const size = { width: 500, height: 500 };
  const start = { scale: 2, x: 50, y: -20 };
  const focal = { x: 80, y: 40 }; const current = { x: 100, y: 50 };
  const result = focalZoom(start, focal, current, 3, size, size);
  assert.equal((current.x - result.x) / result.scale, (focal.x - start.x) / start.scale);
  assert.equal((current.y - result.y) / result.scale, (focal.y - start.y) / start.scale);
});
test('repeated zoom cycles, extreme edge drags, and reset never escape bounds', () => {
  for (const size of [{ width: 320, height: 600 }, { width: 900, height: 400 }]) {
    let value = IDENTITY_ZOOM;
    for (let i = 0; i < 100; i++) {
      const point = { x: size.width * .4, y: size.height * .4 };
      value = focalZoom(value, point, point, i % 2 ? .1 : 20, size, size);
      value = boundZoom({ ...value, x: value.x + 1e6, y: value.y - 1e6 }, size, size);
      assert.ok(Math.abs(value.x) <= (value.scale - 1) * size.width / 2);
      assert.ok(Math.abs(value.y) <= (value.scale - 1) * size.height / 2);
    }
    const reset = focalZoom(value, { x: 0, y: 0 }, { x: 0, y: 0 }, 1, size, size);
    assert.equal(reset.scale, 1); assert.equal(Math.abs(reset.x) + Math.abs(reset.y), 0);
  }
});
