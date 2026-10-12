import { Inflate } from 'fflate';

// ZIP record layout: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
export const ZIP_LIMITS = {
  archiveBytes: 512 * 1024 * 1024,
  directoryBytes: 8 * 1024 * 1024,
  entries: 2000,
  imageBytes: 64 * 1024 * 1024,
  totalBytes: 1024 * 1024 * 1024,
  ratio: 200,
};

export class ComicArchiveError extends Error {
  constructor(message: string) { super(message); this.name = 'ComicArchiveError'; }
}

export type ArchiveEntry = {
  path: string; size: number; compressedSize: number; crc: number;
  method: number; dataOffset: number; image: boolean;
};
export type ReadArchive = (offset: number, length: number) => Uint8Array;

function reject(message = '손상되었거나 지원하지 않는 ZIP 구조입니다.'): never {
  throw new ComicArchiveError(message);
}

function view(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function safePath(bytes: Uint8Array) {
  let path: string;
  try { path = decodeURIComponent(Array.from(bytes, (byte) => `%${byte.toString(16).padStart(2, '0')}`).join('')); }
  catch { return reject('UTF-8로 저장된 파일명만 지원합니다.'); }
  // URI delimiters/escapes are excluded to avoid disagreement between native paths and file URIs.
  if (!path || path.startsWith('/') || /[\\:%?#\u0000-\u001f\u007f]/.test(path)) reject('안전하지 않은 ZIP 파일 경로입니다.');
  const parts = path.replace(/\/$/, '').split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part))) reject('안전하지 않은 ZIP 파일 경로입니다.');
  return path;
}

function validateExtras(bytes: Uint8Array) {
  const data = view(bytes);
  for (let offset = 0; offset < bytes.length;) {
    if (offset + 4 > bytes.length) reject();
    const id = data.getUint16(offset, true);
    const length = data.getUint16(offset + 2, true);
    if (offset + 4 + length > bytes.length) reject();
    // ZIP64, alternate Unicode path and UNIX link metadata are deliberately unsupported.
    if ([0x0001, 0x7075, 0x000d, 0x756e].includes(id)) reject('지원하지 않는 ZIP 확장 메타데이터입니다.');
    offset += 4 + length;
  }
}

export function inspectArchive(size: number, read: ReadArchive): ArchiveEntry[] {
  if (!Number.isSafeInteger(size) || size < 22) reject('비어 있거나 손상된 CBZ 파일입니다.');
  if (size > ZIP_LIMITS.archiveBytes) reject('CBZ 파일은 512 MB 이하만 지원합니다.');
  function exact(offset: number, length: number) {
    if (offset < 0 || length < 0 || offset + length > size) reject();
    const bytes = read(offset, length);
    if (bytes.length !== length) reject();
    return bytes;
  }
  const tailOffset = Math.max(0, size - 65557);
  const tail = exact(tailOffset, size - tailOffset);
  const end = view(tail);
  let position = -1;
  for (let index = tail.length - 22; index >= 0; index--) {
    if (end.getUint32(index, true) === 0x06054b50 && index + 22 + end.getUint16(index + 20, true) === tail.length) {
      position = index; break;
    }
  }
  if (position < 0) reject('ZIP 끝 정보를 찾을 수 없습니다. 파일이 손상되었을 수 있습니다.');
  const count = end.getUint16(position + 10, true);
  const directorySize = end.getUint32(position + 12, true);
  const directoryOffset = end.getUint32(position + 16, true);
  if (end.getUint16(position + 4, true) || end.getUint16(position + 6, true) ||
    end.getUint16(position + 8, true) !== count || count === 65535 || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    reject('분할 ZIP과 ZIP64 파일은 아직 지원하지 않습니다.');
  }
  if (count > ZIP_LIMITS.entries || directorySize > ZIP_LIMITS.directoryBytes) reject('ZIP 항목 수 또는 메타데이터가 너무 큽니다.');
  if (directoryOffset + directorySize !== tailOffset + position) reject();
  const central = exact(directoryOffset, directorySize);
  const data = view(central);
  const entries: ArchiveEntry[] = [];
  const paths = new Map<string, boolean>();
  const ranges: { start: number; end: number }[] = [];
  let cursor = 0;
  let total = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > central.length || data.getUint32(cursor, true) !== 0x02014b50) reject();
    const flags = data.getUint16(cursor + 8, true);
    const method = data.getUint16(cursor + 10, true);
    const crc = data.getUint32(cursor + 16, true);
    const compressedSize = data.getUint32(cursor + 20, true);
    const entrySize = data.getUint32(cursor + 24, true);
    const nameLength = data.getUint16(cursor + 28, true);
    const extraLength = data.getUint16(cursor + 30, true);
    const commentLength = data.getUint16(cursor + 32, true);
    const attributes = data.getUint32(cursor + 38, true);
    const localOffset = data.getUint32(cursor + 42, true);
    const recordEnd = cursor + 46 + nameLength + extraLength + commentLength;
    if (!nameLength || nameLength > 1024 || recordEnd > central.length || data.getUint16(cursor + 34, true)) reject();
    // Only UTF-8, data-descriptor and deflate compression-option flags are supported.
    if (flags & ~0x080e) reject('암호화되었거나 지원하지 않는 ZIP 파일입니다.');
    if (method !== 0 && method !== 8) reject('저장 또는 Deflate 방식의 ZIP만 지원합니다.');
    const name = central.subarray(cursor + 46, cursor + 46 + nameLength);
    const path = safePath(name);
    const unixMode = (attributes >>> 16) & 0xf000;
    if (unixMode && unixMode !== 0x8000 && unixMode !== 0x4000) reject('심볼릭 링크와 특수 파일은 가져올 수 없습니다.');
    const directory = path.endsWith('/');
    if ((unixMode === 0x4000 || (attributes & 0x10)) && !directory) reject();
    const key = path.replace(/\/$/, '').normalize('NFC').toLowerCase();
    if (paths.has(key)) reject('중복되거나 충돌하는 ZIP 경로입니다.');
    paths.set(key, directory);
    validateExtras(central.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength));
    if (entrySize > ZIP_LIMITS.imageBytes || entrySize > Math.max(1, compressedSize) * ZIP_LIMITS.ratio) reject('ZIP 항목의 크기 또는 압축률이 안전 제한을 초과합니다.');
    total += entrySize;
    if (total > ZIP_LIMITS.totalBytes) reject('압축 해제 크기는 총 1 GB 이하만 지원합니다.');
    if (directory && entrySize !== 0) reject();
    if (method === 0 && entrySize !== compressedSize) reject();
    if (localOffset + 30 > directoryOffset) reject();
    const localBytes = exact(localOffset, 30);
    const local = view(localBytes);
    if (local.getUint32(0, true) !== 0x04034b50 || local.getUint16(6, true) !== flags || local.getUint16(8, true) !== method) reject();
    const localNameLength = local.getUint16(26, true);
    const localExtraLength = local.getUint16(28, true);
    if (localNameLength !== nameLength) reject();
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > directoryOffset) reject();
    const localName = exact(localOffset + 30, localNameLength);
    if (!localName.every((byte, byteIndex) => byte === name[byteIndex])) reject('ZIP의 파일 경로 정보가 일치하지 않습니다.');
    validateExtras(exact(localOffset + 30 + localNameLength, localExtraLength));
    if (!(flags & 8) && (local.getUint32(14, true) !== crc || local.getUint32(18, true) !== compressedSize || local.getUint32(22, true) !== entrySize)) reject();
    let entryEnd = dataOffset + compressedSize;
    if (flags & 8) {
      if (entryEnd + 12 > directoryOffset) reject();
      const descriptor = view(exact(entryEnd, Math.min(16, directoryOffset - entryEnd)));
      const base = descriptor.getUint32(0, true) === 0x08074b50 ? 4 : 0;
      if (entryEnd + base + 12 > directoryOffset || descriptor.getUint32(base, true) !== crc ||
        descriptor.getUint32(base + 4, true) !== compressedSize || descriptor.getUint32(base + 8, true) !== entrySize) reject();
      entryEnd += base + 12;
    }
    ranges.push({ start: localOffset, end: entryEnd });
    const hidden = path.split('/').some((part) => part.startsWith('.') || part === '__MACOSX');
    const image = !directory && !hidden && /\.(jpe?g|png|webp)$/i.test(path);
    if (image && entrySize === 0) reject('빈 이미지 파일이 포함되어 있습니다.');
    entries.push({ path, size: entrySize, compressedSize, crc, method, dataOffset, image });
    cursor = recordEnd;
  }
  if (cursor !== central.length) reject();
  for (const path of paths.keys()) {
    const segments = path.split('/');
    for (let index = 1; index < segments.length; index++) {
      if (paths.get(segments.slice(0, index).join('/')) === false) reject('파일과 폴더 경로가 충돌합니다.');
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  for (let index = 1; index < ranges.length; index++) if (ranges[index].start < ranges[index - 1].end) reject();
  if (!entries.some((entry) => entry.image)) reject('읽을 수 있는 JPEG·PNG·WebP 이미지가 없습니다.');
  return entries;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

export function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new ComicArchiveError('가져오기를 취소했습니다. 원본 파일은 보관됩니다.');
}

// Verify actual decompressed byte counts before invoking the native disk extractor.
// Metadata alone is insufficient: an attacker can advertise a smaller output size.
export async function verifyArchiveImages(entries: ArchiveEntry[], read: ReadArchive, signal?: AbortSignal) {
  for (const entry of entries.filter((item) => item.image)) {
    checkCancelled(signal);
    let count = 0;
    let checksum = 0xffffffff;
    const prefix: number[] = [];
    const consume = (bytes: Uint8Array) => {
      count += bytes.length;
      if (count > entry.size || count > ZIP_LIMITS.imageBytes) reject('실제 압축 해제 크기가 ZIP 정보 또는 안전 제한과 다릅니다.');
      for (const byte of bytes) {
        checksum = crcTable[(checksum ^ byte) & 255] ^ (checksum >>> 8);
        if (prefix.length < 12) prefix.push(byte);
      }
    };
    try {
      const inflater = entry.method === 8 ? new Inflate(consume) : undefined;
      // Small compressed chunks bound temporary output allocation even with forged sizes.
      for (let offset = 0; offset < entry.compressedSize;) {
        checkCancelled(signal);
        const length = Math.min(4096, entry.compressedSize - offset);
        const bytes = read(entry.dataOffset + offset, length);
        if (bytes.length !== length) reject();
        offset += length;
        if (inflater) inflater.push(bytes, offset === entry.compressedSize);
        else consume(bytes);
        // Release the JS thread between chunks so cancellation/UI can run.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      if (count !== entry.size || ((checksum ^ 0xffffffff) >>> 0) !== entry.crc) reject('이미지 데이터가 손상되었습니다.');
      const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => prefix[index] === byte);
      const jpeg = prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255;
      const webp = prefix.slice(0, 4).map((byte) => String.fromCharCode(byte)).join('') === 'RIFF' &&
        prefix.slice(8, 12).map((byte) => String.fromCharCode(byte)).join('') === 'WEBP';
      if (/\.png$/i.test(entry.path) ? !png : /\.jpe?g$/i.test(entry.path) ? !jpeg : !webp) reject('이미지 형식과 파일 확장자가 일치하지 않습니다.');
    } catch (error) {
      if (error instanceof ComicArchiveError) throw error;
      reject('압축된 이미지 데이터가 손상되었습니다.');
    }
  }
  checkCancelled(signal);
}
