// Hashes only select candidates. Byte equality decides whether a book is a duplicate.
export async function equalFileBytes(size: number, left: (offset: number, length: number) => Uint8Array,
  right: (offset: number, length: number) => Uint8Array): Promise<boolean> {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid file size');
  const chunk = 64 * 1024;
  for (let offset = 0; offset < size; offset += chunk) {
    const length = Math.min(chunk, size - offset);
    const a = left(offset, length); const b = right(offset, length);
    if (a.length !== length || b.length !== length) throw new Error('파일 비교 중 읽기가 중단되었습니다. 다시 가져와 주세요.');
    for (let i = 0; i < length; i++) if (a[i] !== b[i]) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return true;
}
