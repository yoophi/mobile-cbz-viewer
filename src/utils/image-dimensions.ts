export type ImageDimensions = { width: number; height: number };
type Read = (offset: number, length: number) => Uint8Array;

// Read only format metadata, seeking past JPEG/RIFF payloads without decoding pixels.
export function readImageDimensions(size: number, read: Read): ImageDimensions | undefined {
  const bytes = (offset: number, length: number) => {
    if (offset < 0 || length < 0 || offset + length > size) return new Uint8Array();
    return read(offset, length);
  };
  const word = (b: Uint8Array, at: number, little = false) => little ? b[at] + b[at + 1] * 256 : b[at] * 256 + b[at + 1];
  const integer = (b: Uint8Array, at: number, little = false) => little
    ? b[at] + b[at + 1] * 256 + b[at + 2] * 65536 + b[at + 3] * 16777216
    : b[at] * 16777216 + b[at + 1] * 65536 + b[at + 2] * 256 + b[at + 3];
  const result = (width: number, height: number) => Number.isSafeInteger(width) && Number.isSafeInteger(height)
    && width > 0 && height > 0 && width <= 1000000 && height <= 1000000 ? { width, height } : undefined;
  const prefix = bytes(0, Math.min(32, size));
  if (prefix.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => prefix[index] === value)
    && integer(prefix, 8) === 13 && String.fromCharCode(...prefix.slice(12, 16)) === 'IHDR') {
    return result(integer(prefix, 16), integer(prefix, 20));
  }
  if (prefix[0] === 255 && prefix[1] === 216) {
    let cursor = 2; let orientation = 1; let dimensions: ImageDimensions | undefined;
    const startsOfFrame = new Set([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207]);
    for (let markers = 0; markers < 512 && cursor + 4 <= size; markers++) {
      const marker = bytes(cursor, 4);
      if (marker.length !== 4 || marker[0] !== 255) break;
      if (marker[1] === 255) { cursor++; continue; }
      if (marker[1] === 218 || marker[1] === 217) break; // Pixel stream / end.
      if (marker[1] === 1 || (marker[1] >= 208 && marker[1] <= 216)) { cursor += 2; continue; }
      const length = word(marker, 2);
      if (length < 2 || cursor + 2 + length > size) break;
      if (startsOfFrame.has(marker[1]) && length >= 8) {
        const frame = bytes(cursor + 4, 5);
        dimensions = result(word(frame, 3), word(frame, 1));
      }
      if (marker[1] === 225 && length >= 16) {
        const header = bytes(cursor + 4, 14);
        if (String.fromCharCode(...header.slice(0, 6)) === 'Exif\0\0') {
          const little = header[6] === 73 && header[7] === 73;
          const big = header[6] === 77 && header[7] === 77;
          const base = cursor + 10;
          const end = cursor + 2 + length;
          if ((little || big) && word(header, 8, little) === 42) {
            const ifd = base + integer(header, 10, little);
            if (ifd >= base + 8 && ifd + 2 <= end) {
              const count = word(bytes(ifd, 2), 0, little);
              if (count <= 256 && ifd + 2 + count * 12 <= end) {
                const fields = bytes(ifd + 2, count * 12);
                for (let offset = 0; offset < fields.length; offset += 12) {
                  if (word(fields, offset, little) === 274 && word(fields, offset + 2, little) === 3
                    && integer(fields, offset + 4, little) === 1) orientation = word(fields, offset + 8, little);
                }
              }
            }
          }
        }
      }
      cursor += length + 2;
    }
    return dimensions && orientation >= 5 && orientation <= 8
      ? { width: dimensions.height, height: dimensions.width } : dimensions;
  }
  if (prefix.length >= 12 && String.fromCharCode(...prefix.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...prefix.slice(8, 12)) === 'WEBP') {
    for (let cursor = 12, chunks = 0; cursor + 8 <= size && chunks < 128; chunks++) {
      const chunk = bytes(cursor, 8); const length = integer(chunk, 4, true);
      if (cursor + 8 + length > size) return undefined;
      const kind = String.fromCharCode(...chunk.slice(0, 4));
      const data = bytes(cursor + 8, Math.min(10, length));
      if (kind === 'VP8X' && data.length >= 10) {
        const triplet = (offset: number) => data[offset] + data[offset + 1] * 256 + data[offset + 2] * 65536 + 1;
        return result(triplet(4), triplet(7));
      }
      if (kind === 'VP8 ' && data.length >= 10 && data[3] === 157 && data[4] === 1 && data[5] === 42) {
        return result(word(data, 6, true) & 16383, word(data, 8, true) & 16383);
      }
      if (kind === 'VP8L' && data.length >= 5 && data[0] === 47 && data[4] >> 5 === 0) {
        return result(1 + data[1] + ((data[2] & 63) << 8), 1 + (data[2] >> 6) + (data[3] << 2) + ((data[4] & 15) << 10));
      }
      cursor += 8 + length + (length & 1);
    }
  }
  return undefined;
}
