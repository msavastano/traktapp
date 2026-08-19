/**
 * TMDB client — the source of streaming-availability data.
 *
 * Why TMDB and not Simkl: Simkl exposes no streaming provider for movies.
 * Verified against the live API — the CDN movie calendar entries are only
 * `{simkl_id, date, finale_type}`, `GET /movies/{id}` returns release events
 * as bare `{type, release_date}` pairs with no provider `note`, and the
 * `network` path segment exists only on the TV and anime genre-browse
 * endpoints, never on `/movies/genres/...`.
 *
 * TMDB's provider data is licensed from JustWatch and splits availability by
 * monetization type, which is exactly the "subscription, not pay-per-view"
 * distinction this app needs: `flatrate` / `free` / `ads` are included with a
 * subscription or free with adverts, while `rent` / `buy` are transactional.
 *
 * ⚠️ Two constraints that come with this data:
 *
 * 1. **JustWatch attribution is mandatory.** TMDB's terms: "In order to use
 *    this data you must attribute the source of the data as JustWatch."
 *    `components/upcoming-streaming.tsx` renders that credit — don't remove it.
 * 2. **It is a snapshot of *current* availability, not a schedule.** There is
 *    no "arrives on Netflix on the 3rd" field anywhere in TMDB, and JustWatch
 *    ships TMDB a single daily export. So this module answers "what recently
 *    landed on these services", never "what will land next month".
 */

const TMDB_API_BASE = "https://api.themoviedb.org/3";

// Poster/link helpers live in lib/images.ts alongside the Simkl ones, for the
// same reason: this module is server-only (it reads TMDB_API_KEY) and must not
// be pulled into a client bundle.

/** Default region. Provider availability is entirely region-specific. */
export const DEFAULT_REGION = "US";

/**
 * Monetization types that count as "streaming" for this feature:
 * included with a subscription (`flatrate`), free (`free`), or free with
 * adverts (`ads`). `rent` and `buy` are deliberately absent — those are the
 * pay-per-view options the feed is meant to exclude.
 */
export const SUBSCRIPTION_MONETIZATION = ["flatrate", "free", "ads"] as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

export function tmdbUrl(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {}
): string {
  const url = new URL(
    `${TMDB_API_BASE}${path.startsWith("/") ? path : `/${path}`}`
  );
  url.searchParams.set("api_key", requireEnv("TMDB_API_KEY"));
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * Retries on 429 and on network errors, mirroring `fetchSimkl`. TMDB's limit
 * is far more generous than Simkl's (no published per-second cap since 2023,
 * versus Simkl's 10 GET/sec), so this is a safety net rather than a hot path.
 */
export async function fetchTmdb(
  url: string,
  options: RequestInit = {},
  maxRetries = 3
): Promise<Response> {
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      const res = await fetch(url, options);
      if (res.status === 429 && attempt <= maxRetries) {
        const retryAfter = res.headers.get("Retry-After");
        const seconds = retryAfter ? parseInt(retryAfter, 10) : null;
        const delayMs =
          (seconds && Number.isFinite(seconds) && seconds > 0
            ? seconds
            : Math.pow(2, attempt)) * 1000;
        console.warn(
          `[TMDB] Rate limited (429). Retrying ${attempt}/${maxRetries} after ${delayMs}ms...`
        );
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      return res;
    } catch (err) {
      if (attempt > maxRetries) throw err;
      const delayMs = Math.pow(2, attempt) * 1000;
      console.warn(
        `[TMDB] Network error. Retrying ${attempt}/${maxRetries} after ${delayMs}ms...`,
        err
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

/**
 * The services this feed covers, matched by name rather than by hardcoded id.
 *
 * TMDB provider ids are stable, but the *names* churn and the catalogue gains
 * entries — "HBO Max" became "Max" in 2023 and reverted in 2025, each rename
 * arriving with a different id. Resolving against the live provider list at
 * runtime means a rename fixes itself; a hardcoded table would silently drop
 * a whole service from the feed with no error.
 *
 * Patterns are deliberately anchored. The traps they avoid:
 *   - "Amazon Video" (transactional) vs "Amazon Prime Video" (subscription)
 *   - "Apple TV" (transactional) vs "Apple TV+" (subscription)
 * Both siblings would otherwise match a loose /apple|amazon/ pattern.
 *
 * Each ends in `( .*)?$` rather than a word boundary so ad-supported and
 * premium tiers ("Netflix Standard with Ads", "Paramount Plus Premium") still
 * resolve, while requiring the space stops a hypothetical "Maxdome" matching
 * "Max". A trailing  would be actively wrong here: after a literal "+" at
 * end-of-string there is no word boundary, so /paramount\s*(\+|plus)/ fails
 * to match "Paramount+" itself.
 */
export interface StreamingService {
  key: string;
  label: string;
  pattern: RegExp;
}

export const STREAMING_SERVICES: StreamingService[] = [
  { key: "netflix", label: "Netflix", pattern: /^netflix( .*)?$/i },
  { key: "disney", label: "Disney+", pattern: /^disney\s*(\+|plus)( .*)?$/i },
  { key: "paramount", label: "Paramount+", pattern: /^paramount\s*(\+|plus)( .*)?$/i },
  { key: "prime", label: "Prime Video", pattern: /^amazon prime video( .*)?$/i },
  { key: "appletv", label: "Apple TV+", pattern: /^apple tv\s*(\+|plus)( .*)?$/i },
  { key: "peacock", label: "Peacock", pattern: /^peacock( .*)?$/i },
  { key: "hbomax", label: "HBO Max", pattern: /^(hbo\s*)?max( .*)?$/i },
  { key: "amc", label: "AMC+", pattern: /^amc\s*(\+|plus)( .*)?$/i },
];

interface TmdbProvider {
  provider_id: number;
  provider_name: string;
  logo_path?: string | null;
  display_priority?: number;
}

export interface ResolvedProvider {
  id: number;
  /** Our service key, e.g. "hbomax" — stable even when TMDB renames. */
  key: string;
  /** Our display label, e.g. "HBO Max". */
  label: string;
  /** The name TMDB actually returned, kept for debugging renames. */
  tmdbName: string;
}

// Resolved once per process. The provider catalogue changes on the order of
// months, and a cold start re-fetches it, so there's no staleness worth a TTL.
let providerCache: { region: string; providers: ResolvedProvider[] } | null =
  null;

/**
 * Maps STREAMING_SERVICES onto live TMDB provider ids for a region.
 *
 * Reseller entries ("Paramount+ Amazon Channel", "AMC+ Apple TV Channel") are
 * dropped: they carry separate ids for content already surfaced by the parent
 * service, so keeping them would double up the badges on every card.
 */
export async function resolveProviders(
  region: string = DEFAULT_REGION
): Promise<ResolvedProvider[]> {
  if (providerCache && providerCache.region === region) {
    return providerCache.providers;
  }

  const res = await fetchTmdb(
    tmdbUrl("/watch/providers/movie", { watch_region: region })
  );
  if (!res.ok) {
    throw new Error(`TMDB provider list failed (${res.status})`);
  }

  const body: { results?: TmdbProvider[] } = await res.json();
  const all = body.results ?? [];

  const resolved: ResolvedProvider[] = [];
  for (const service of STREAMING_SERVICES) {
    const match = all.find(
      (p) =>
        !/\bchannel\b/i.test(p.provider_name) &&
        service.pattern.test(p.provider_name.trim())
    );
    if (match) {
      resolved.push({
        id: match.provider_id,
        key: service.key,
        label: service.label,
        tmdbName: match.provider_name,
      });
    } else {
      // Not fatal — the other services still produce a useful feed — but it
      // means either a TMDB rename or that the service left this region.
      console.warn(
        `[TMDB] No ${region} provider matched "${service.label}" (${service.pattern}).`
      );
    }
  }

  if (resolved.length === 0) {
    throw new Error(
      `No streaming providers resolved for region ${region} — check TMDB_API_KEY and the region code.`
    );
  }

  providerCache = { region, providers: resolved };
  return resolved;
}

// ---------------------------------------------------------------------------
// Discover + per-title availability
// ---------------------------------------------------------------------------

export interface TmdbDiscoverMovie {
  id: number;
  title: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  vote_average?: number;
  vote_count?: number;
  genre_ids?: number[];
}

interface TmdbDiscoverResponse {
  page: number;
  results: TmdbDiscoverMovie[];
  total_pages: number;
  total_results: number;
}

/**
 * Movies released within a window that are currently on one of the given
 * providers under a subscription/free tier.
 *
 * Ordered by release date descending, which is the closest honest proxy for
 * "new on streaming" that TMDB supports. Streaming originals carry their
 * streaming debut as `primary_release_date`, so they sort correctly; a
 * theatrical title sorts by its theatrical date and drifts down the list over
 * the weeks before it reaches a subscription tier. That drift is why the
 * window reaches months back rather than days.
 */
export async function discoverStreamingMovies(opts: {
  providerIds: number[];
  region?: string;
  /** Inclusive lower bound, YYYY-MM-DD. */
  releasedFrom: string;
  /** Inclusive upper bound, YYYY-MM-DD. */
  releasedTo: string;
  page?: number;
}): Promise<TmdbDiscoverResponse> {
  const region = opts.region ?? DEFAULT_REGION;
  const url = tmdbUrl("/discover/movie", {
    watch_region: region,
    // Pipe is OR — a title on any one of these services qualifies.
    with_watch_providers: opts.providerIds.join("|"),
    with_watch_monetization_types: SUBSCRIPTION_MONETIZATION.join("|"),
    "primary_release_date.gte": opts.releasedFrom,
    "primary_release_date.lte": opts.releasedTo,
    sort_by: "primary_release_date.desc",
    include_adult: false,
    include_video: false,
    language: "en-US",
    page: opts.page ?? 1,
  });

  const res = await fetchTmdb(url);
  if (!res.ok) {
    throw new Error(`TMDB discover failed (${res.status})`);
  }
  return res.json();
}

interface TmdbWatchProviderResponse {
  id: number;
  results?: Record<
    string,
    {
      link?: string;
      flatrate?: TmdbProvider[];
      free?: TmdbProvider[];
      ads?: TmdbProvider[];
      rent?: TmdbProvider[];
      buy?: TmdbProvider[];
    }
  >;
}

export interface TitleAvailability {
  /** Service keys from STREAMING_SERVICES, e.g. ["netflix", "hbomax"]. */
  serviceKeys: string[];
  /** TMDB's JustWatch-backed page for this title, for the required credit. */
  link: string | null;
}

/**
 * Which of our tracked services carry this title on a subscription/free tier.
 *
 * `discover` tells us a title matched *some* provider in the OR list but never
 * which one, so this second call is what turns a match into badges. Only the
 * three subscription buckets are read — `rent` and `buy` are ignored outright,
 * so a title available to rent on Prime but streaming nowhere returns [].
 */
export async function fetchTitleAvailability(
  tmdbId: number,
  providers: ResolvedProvider[],
  region: string = DEFAULT_REGION
): Promise<TitleAvailability> {
  const res = await fetchTmdb(
    tmdbUrl(`/movie/${tmdbId}/watch/providers`)
  );
  if (!res.ok) {
    throw new Error(`TMDB watch/providers failed for ${tmdbId} (${res.status})`);
  }

  const body: TmdbWatchProviderResponse = await res.json();
  const forRegion = body.results?.[region];
  if (!forRegion) return { serviceKeys: [], link: null };

  const byId = new Map(providers.map((p) => [p.id, p.key]));
  const keys = new Set<string>();
  for (const bucket of SUBSCRIPTION_MONETIZATION) {
    for (const entry of forRegion[bucket] ?? []) {
      const key = byId.get(entry.provider_id);
      if (key) keys.add(key);
    }
  }

  return {
    serviceKeys: [...keys],
    link: forRegion.link ?? null,
  };
}
