/**
 * OMDb enrichment: fetches the Rotten Tomatoes Tomatometer (critic %) for a
 * show by IMDb id.
 *
 * Design rule: RT score is OPTIONAL. This module NEVER throws and NEVER
 * surfaces an error. Every failure path — missing API key, bad key, rate
 * limit reached, network error, or show with no RT rating — resolves to
 * `null`, and the UI simply omits the badge.
 *
 * OMDb free tier is 1000 requests/day. To stay well under it:
 *   - RT scores are cached per IMDb id with a long TTL (they change rarely).
 *   - A process-level circuit breaker trips the first time the daily limit is
 *     hit, after which we skip all OMDb calls (no wasted latency) until the
 *     next cold start.
 */

const OMDB_API_BASE = "https://www.omdbapi.com/";

// Long TTL — RT critic scores are effectively static for our purposes.
const RT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const RT_CACHE_MAX_ENTRIES = 1000;

interface RtCacheEntry {
  // null is a legitimate cached result ("looked it up, no RT score exists").
  value: number | null;
  expiresAt: number;
}

const rtCache = new Map<string, RtCacheEntry>();

// Trips when OMDb reports the daily request limit is exhausted. Once tripped,
// we stop calling OMDb for the rest of this process's life. Reset on cold start.
let quotaExhausted = false;

function cacheGet(imdbId: string): RtCacheEntry | undefined {
  const entry = rtCache.get(imdbId);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    rtCache.delete(imdbId);
    return undefined;
  }
  return entry;
}

function cacheSet(imdbId: string, value: number | null): void {
  if (rtCache.size >= RT_CACHE_MAX_ENTRIES) {
    const oldest = rtCache.keys().next().value;
    if (oldest !== undefined) rtCache.delete(oldest);
  }
  rtCache.set(imdbId, { value, expiresAt: Date.now() + RT_CACHE_TTL_MS });
}

/**
 * Parse the "Rotten Tomatoes" entry out of OMDb's `Ratings` array.
 * OMDb returns it as e.g. `{ Source: "Rotten Tomatoes", Value: "92%" }`.
 * Returns the integer percentage, or null if absent/unparseable.
 */
function parseRtScore(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ratings = (data as any).Ratings;
  if (!Array.isArray(ratings)) return null;
  const rt = ratings.find(
    (r) => r && r.Source === "Rotten Tomatoes" && typeof r.Value === "string"
  );
  if (!rt) return null;
  const match = /^(\d+)%$/.exec(rt.Value.trim());
  if (!match) return null;
  const pct = parseInt(match[1], 10);
  return Number.isFinite(pct) ? pct : null;
}

/**
 * Fetch the Rotten Tomatoes critic score (0-100) for a show by IMDb id.
 * Always resolves; returns null on any failure or absence.
 */
export async function fetchRtScore(
  imdbId: string | null | undefined
): Promise<number | null> {
  if (!imdbId) return null;

  const apiKey = process.env.OMDB_API_KEY;
  if (!apiKey) return null; // no key configured → silently skip

  // Cache hit (including a cached null) — no network call.
  const cached = cacheGet(imdbId);
  if (cached) return cached.value;

  // Daily quota already known to be blown — don't bother hitting the API.
  if (quotaExhausted) return null;

  try {
    const url = `${OMDB_API_BASE}?apikey=${encodeURIComponent(
      apiKey
    )}&i=${encodeURIComponent(imdbId)}&tomatoes=true`;
    const res = await fetch(url, { cache: "no-store" });

    // 401 = invalid/exhausted key. Treat as quota exhausted to stop retrying.
    if (res.status === 401) {
      quotaExhausted = true;
      console.warn("OMDb 401 (invalid key or exhausted) — disabling RT lookups");
      return null;
    }
    if (!res.ok) {
      console.warn(`fetchRtScore ${imdbId} -> ${res.status}`);
      return null;
    }

    const data = await res.json();

    // OMDb signals errors with HTTP 200 + { Response: "False", Error: ... }.
    if (data?.Response === "False") {
      const err = String(data?.Error ?? "");
      if (/request limit reached/i.test(err)) {
        quotaExhausted = true;
        console.warn("OMDb daily request limit reached — disabling RT lookups");
      }
      // Other "False" cases (e.g. "Incorrect IMDb ID") — cache null so we
      // don't keep re-requesting a known-missing id.
      else {
        cacheSet(imdbId, null);
      }
      return null;
    }

    const score = parseRtScore(data);
    cacheSet(imdbId, score); // cache the result (number or null)
    return score;
  } catch (err) {
    console.warn(`fetchRtScore ${imdbId} threw:`, err);
    return null;
  }
}
