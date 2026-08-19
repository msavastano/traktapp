/**
 * "New on Streaming" — movies now watchable on a subscription tier of
 * Netflix, Disney+, Paramount+, Prime Video, Apple TV+, Peacock, HBO Max or
 * AMC+, excluding anything that is only available to rent or buy.
 *
 * ⚠️ This does not come from Simkl, and it can't. Checked against the live
 * Simkl API before switching:
 *
 *   - the CDN movie calendar entries are `{simkl_id, date, finale_type}`,
 *     and none of the 19 metadata fields names a service or a release type
 *   - `GET /movies/{id}` does return `release_dates[].results[].type`, where
 *     `4` means "digital" — but the results carry only `{type, release_date}`,
 *     with no provider `note` (TMDB has one; Simkl drops it). "Digital" also
 *     lumps pay-per-view rental in with subscription, which is precisely the
 *     line this feature has to draw
 *   - the `network` filter exists only at `/tv/genres/…` and `/anime/genres/…`;
 *     `/movies/genres/{genre}/{type}/{country}/{year}/{sort}` has no such
 *     segment
 *   - `/search/random?service=` supports only netflix, hulu and crunchy, and
 *     returns an undated random pick
 *
 * ⚠️ **This is "recently landed", not "arriving soon".** TMDB (via JustWatch)
 * publishes a snapshot of *current* availability with no future-dated field
 * anywhere, so "arrives on Netflix on the 3rd" is not answerable from this
 * data at all. What the feed actually shows is recent movies that are on one
 * of those services *today*, newest release first. The tab wording has to
 * match that or it lies to the user.
 */

import type { StreamingMovie, StreamingRelease } from "./types";
import {
  DEFAULT_REGION,
  discoverStreamingMovies,
  fetchTitleAvailability,
  resolveProviders,
  type ResolvedProvider,
} from "./tmdb";

/**
 * How far back to look. A theatrical title typically reaches a subscription
 * tier several months after release and sorts by its *theatrical* date, so a
 * short window would show streaming originals only and miss everything else.
 */
const DEFAULT_LOOKBACK_DAYS = 150;

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toMovie(m: {
  id: number;
  title: string;
  overview?: string;
  poster_path?: string | null;
  release_date?: string;
  vote_average?: number;
  vote_count?: number;
}): StreamingMovie {
  return {
    tmdbId: m.id,
    title: m.title,
    year: m.release_date ? Number(m.release_date.slice(0, 4)) || null : null,
    posterPath: m.poster_path ?? null,
    overview: m.overview || undefined,
    // TMDB returns 0 for "unrated", which would render as a misleading ⭐ 0.0.
    rating: m.vote_average && m.vote_average > 0 ? m.vote_average : undefined,
    votes: m.vote_count || undefined,
  };
}

/** A discover hit, before its per-service availability is known. */
interface Candidate {
  movie: StreamingMovie;
  releaseDate: string;
}

/**
 * Resolves which services carry each title, in small batches.
 *
 * `discover` only reports that a title matched *some* provider in the OR
 * list, never which — so the badges need one extra call per title. Batched at
 * 8 to stay polite; TMDB has no published per-second cap but this runs behind
 * a 6h cache either way. A title whose lookup fails is dropped rather than
 * shown with no badges, since an unlabelled card can't be acted on.
 */
async function attachAvailability(
  candidates: Candidate[],
  providers: ResolvedProvider[],
  region: string,
  concurrency = 8
): Promise<StreamingRelease[]> {
  const out: StreamingRelease[] = [];

  for (let i = 0; i < candidates.length; i += concurrency) {
    const batch = candidates.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map(async ({ movie, releaseDate }) => {
        const availability = await fetchTitleAvailability(
          movie.tmdbId,
          providers,
          region
        );
        return { movie, releaseDate, availability };
      })
    );

    for (const r of settled) {
      if (r.status === "rejected") {
        console.error("TMDB availability lookup failed:", r.reason);
        continue;
      }
      const { movie, releaseDate, availability } = r.value;
      if (availability.serviceKeys.length === 0) continue;
      out.push({
        movie,
        releaseDate,
        serviceKeys: availability.serviceKeys,
        watchLink: availability.link,
      });
    }
  }

  return out;
}

/**
 * Movies on a tracked subscription service, newest release first.
 *
 * The result is identical for every user in a region, so the caller is
 * expected to cache it rather than this refetching.
 */
export async function fetchNewOnStreaming(
  limit = 40,
  region: string = DEFAULT_REGION,
  lookbackDays = DEFAULT_LOOKBACK_DAYS
): Promise<StreamingRelease[]> {
  const providers = await resolveProviders(region);

  const now = new Date();
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - lookbackDays);

  // Discover pages hold 20; pull enough that the availability filter below
  // still leaves a full grid, capped so a wide `limit` can't run away.
  const pagesNeeded = Math.min(5, Math.ceil(limit / 20) + 1);

  const dateFrom = toDateString(from);
  const dateTo = toDateString(now);

  const seen = new Set<number>();
  const candidates: Candidate[] = [];

  for (let page = 1; page <= pagesNeeded; page++) {
    const body = await discoverStreamingMovies({
      providerIds: providers.map((p) => p.id),
      region,
      releasedFrom: dateFrom,
      releasedTo: dateTo,
      page,
    });

    for (const result of body.results ?? []) {
      if (seen.has(result.id) || !result.title || !result.release_date) continue;
      seen.add(result.id);
      candidates.push({ movie: toMovie(result), releaseDate: result.release_date });
    }

    if (page >= body.total_pages) break;
  }

  const releases = await attachAvailability(candidates, providers, region);

  return releases
    .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))
    .slice(0, limit);
}
