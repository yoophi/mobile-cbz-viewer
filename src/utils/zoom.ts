export type ZoomTransform = { scale: number; x: number; y: number };
export type ZoomSize = { width: number; height: number };
export const MAX_ZOOM = 4;
export const IDENTITY_ZOOM: ZoomTransform = { scale: 1, x: 0, y: 0 };

export function containSize(viewport: ZoomSize, image?: ZoomSize): ZoomSize {
  'worklet';
  if (!image || image.width <= 0 || image.height <= 0) return viewport;
  const ratio = Math.min(viewport.width / image.width, viewport.height / image.height);
  return { width: image.width * ratio, height: image.height * ratio };
}

export function boundZoom(value: ZoomTransform, viewport: ZoomSize, content: ZoomSize): ZoomTransform {
  'worklet';
  const scale = Math.max(1, Math.min(MAX_ZOOM, value.scale));
  const maxX = Math.max(0, (content.width * scale - viewport.width) / 2);
  const maxY = Math.max(0, (content.height * scale - viewport.height) / 2);
  return { scale, x: Math.max(-maxX, Math.min(maxX, value.x)), y: Math.max(-maxY, Math.min(maxY, value.y)) };
}

// Coordinates are relative to the viewport centre. Preserve the source point under
// the initial focal position while the fingers both scale and move.
export function focalZoom(start: ZoomTransform, focal: { x: number; y: number },
  current: { x: number; y: number }, scale: number, viewport: ZoomSize, content: ZoomSize): ZoomTransform {
  'worklet';
  const nextScale = Math.max(1, Math.min(MAX_ZOOM, scale));
  return boundZoom({ scale: nextScale,
    x: current.x - (focal.x - start.x) * nextScale / start.scale,
    y: current.y - (focal.y - start.y) * nextScale / start.scale }, viewport, content);
}
