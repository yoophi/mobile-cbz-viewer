export type CacheBudget = { extractedBytes: number; coverBytes: number; bookOverheadBytes: number };
export const CACHE_LIMITS: CacheBudget = { extractedBytes: 512 * 1024 * 1024, coverBytes: 16 * 1024 * 1024, bookOverheadBytes: 2 * 1024 * 1024 };

export type CacheEntry = { id: number; bytes: number; coverBytes: number; lastAccess: number };

// Pure selection: preserve readers and evict deterministically by least recent use.
export function selectCacheEvictions(entries: CacheEntry[], protectedIds: ReadonlySet<number>,
  incomingBytes = 0, incomingCoverBytes = 0, limits = CACHE_LIMITS): number[] {
  let total = entries.reduce((sum, entry) => sum + entry.bytes, incomingBytes);
  let covers = entries.reduce((sum, entry) => sum + entry.coverBytes, incomingCoverBytes);
  const evictions: number[] = [];
  for (const entry of [...entries].sort((a, b) => a.lastAccess - b.lastAccess || a.id - b.id)) {
    if (total <= limits.extractedBytes && covers <= limits.coverBytes) break;
    if (protectedIds.has(entry.id)) continue;
    evictions.push(entry.id);
    total -= entry.bytes;
    covers -= entry.coverBytes;
  }
  if (total > limits.extractedBytes || covers > limits.coverBytes) throw new Error('열람 중인 책을 보호하기 위해 캐시를 정리하지 못했습니다. 다른 책을 닫거나 더 작은 CBZ를 선택해 주세요.');
  return evictions;
}
