/**
 * Small in-memory TTL cache for search grounding (design doc §2.6 rate guard,
 * §2.7 latency budget). It keeps shared-IP free quotas safe (Open-Meteo warns
 * that shared-IP platforms share limits) and avoids charging the Tavily
 * monthly counter twice for the same question.
 *
 * TTLs stay inside each question type's freshness window: weather 45 minutes
 * (design range 30-60), news headlines 15 minutes, search results 15 minutes.
 */

export const ORIGIN_SEARCH_CACHE_TTL_MS = {
  weather: 45 * 60 * 1000,
  news: 15 * 60 * 1000,
  search: 15 * 60 * 1000,
  // Market quotes are delayed data to begin with; 5 minutes keeps repeated
  // questions inside the freshness window without hammering a keyless
  // endpoint that reportedly enforces an unpublished per-IP daily limit.
  market: 5 * 60 * 1000,
} as const;

interface CacheEntry<T> {
  value: T;
  expiresAtMs: number;
}

export class OriginSearchTtlCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly maxEntries: number;

  constructor(maxEntries = 200) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  get<T>(key: string, nowMs: number): T | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (nowMs >= entry.expiresAtMs) {
      this.entries.delete(key);
      return null;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number, nowMs: number): void {
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAtMs: nowMs + ttlMs });
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

export const defaultOriginSearchCache = new OriginSearchTtlCache();

export function resetOriginSearchCacheForTests(): void {
  defaultOriginSearchCache.clear();
}
