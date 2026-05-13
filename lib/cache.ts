/**
 * Tiny TTL cache for /api/watchlist responses.
 *
 * Keyed by access_token (so per-user). Module-level Map — survives across
 * requests on a warm Node instance. On Vercel serverless, cold starts reset
 * it, but within a warm function instance back-to-back requests hit cache.
 *
 * Not a substitute for Redis/KV in production multi-instance deployments.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 100;

const store = new Map<string, Entry<unknown>>();

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs = TTL_MS): void {
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function cacheDelete(key: string): void {
  store.delete(key);
}

export function watchlistKey(accessToken: string): string {
  return `watchlist:${accessToken}`;
}
