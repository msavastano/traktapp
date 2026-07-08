/**
 * Movie discovery + "upcoming on streaming" heuristic.
 *
 * Trakt has no structured watch-provider data. The only signal available is
 * GET /movies/{id}/releases/{country}: studios sometimes license a movie to
 * a premium channel/streaming service for a window after its initial home
 * video release, and Trakt records this as an extra `digital`/`tv` release
 * entry with the service name stuffed into the freeform `note` field (e.g.
 * note: "Starz", note: "HBO"). This is a best-effort heuristic, not an
 * authoritative provider API — `note` is also used for festival names on
 * `premiere` entries and disc specs on `physical` entries, and most movies
 * won't have this deal logged at all.
 */

import type { TraktMovie, TraktMovieRelease, UpcomingStreamingRelease } from "./types";
import { fetchTrakt, TRAKT_API_BASE, baseHeaders } from "./trakt";

interface TraktTrendingMovieItem {
  watchers: number;
  movie: TraktMovie;
}

const CANDIDATE_LIMIT = 40;

export async function fetchTrendingMovies(
  limit = CANDIDATE_LIMIT
): Promise<TraktMovie[]> {
  try {
    const params = new URLSearchParams({
      extended: "full,images",
      page: "1",
      limit: String(limit),
    });
    const res = await fetchTrakt(
      `${TRAKT_API_BASE}/movies/trending?${params.toString()}`,
      { headers: baseHeaders() }
    );
    if (!res.ok) {
      console.warn(`fetchTrendingMovies -> ${res.status}`);
      return [];
    }
    const data: TraktTrendingMovieItem[] = await res.json();
    return data.map((item) => item.movie).filter(Boolean);
  } catch (err) {
    console.warn("fetchTrendingMovies threw:", err);
    return [];
  }
}

export async function fetchPopularMovies(
  limit = CANDIDATE_LIMIT
): Promise<TraktMovie[]> {
  try {
    const params = new URLSearchParams({
      extended: "full,images",
      page: "1",
      limit: String(limit),
    });
    const res = await fetchTrakt(
      `${TRAKT_API_BASE}/movies/popular?${params.toString()}`,
      { headers: baseHeaders() }
    );
    if (!res.ok) {
      console.warn(`fetchPopularMovies -> ${res.status}`);
      return [];
    }
    const data: TraktMovie[] = await res.json();
    return data.filter(Boolean);
  } catch (err) {
    console.warn("fetchPopularMovies threw:", err);
    return [];
  }
}

/** Trending union popular, deduped by ids.trakt. */
export async function fetchCandidateMoviePool(): Promise<TraktMovie[]> {
  const [trending, popular] = await Promise.all([
    fetchTrendingMovies(),
    fetchPopularMovies(),
  ]);
  const byId = new Map<number, TraktMovie>();
  for (const m of [...trending, ...popular]) {
    if (m?.ids?.trakt) byId.set(m.ids.trakt, m);
  }
  return Array.from(byId.values());
}

export async function fetchMovieReleases(
  movieId: number,
  country = "us"
): Promise<TraktMovieRelease[] | null> {
  try {
    const res = await fetchTrakt(
      `${TRAKT_API_BASE}/movies/${movieId}/releases/${country}`,
      { headers: baseHeaders() }
    );
    if (!res.ok) {
      console.warn(`fetchMovieReleases ${movieId} -> ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn(`fetchMovieReleases ${movieId} threw:`, err);
    return null;
  }
}

/**
 * Picks the soonest release entry that looks like an upcoming "free with
 * subscription" streaming window: release_type digital|tv, a non-empty
 * note (the only place a service name shows up), dated today or later.
 */
export function findUpcomingStreamingRelease(
  releases: TraktMovieRelease[],
  now: Date = new Date()
): TraktMovieRelease | null {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const candidates = releases.filter((r) => {
    if (r.release_type !== "digital" && r.release_type !== "tv") return false;
    if (!r.note || !r.note.trim()) return false;
    const d = new Date(r.release_date);
    if (isNaN(d.getTime())) return false;
    return d >= startOfToday;
  });
  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) => new Date(a.release_date).getTime() - new Date(b.release_date).getTime()
  );
  return candidates[0];
}

export async function fetchUpcomingStreamingReleases(
  movies: TraktMovie[],
  concurrency = 4
): Promise<UpcomingStreamingRelease[]> {
  const results: UpcomingStreamingRelease[] = [];

  for (let i = 0; i < movies.length; i += concurrency) {
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const batch = movies.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map(async (movie) => {
        const releases = await fetchMovieReleases(movie.ids.trakt, "us");
        if (!releases) return null;
        const match = findUpcomingStreamingRelease(releases);
        return match ? { movie, release: match } : null;
      })
    );
    for (const r of settled) {
      if (r.status === "fulfilled" && r.value) {
        results.push(r.value);
      } else if (r.status === "rejected") {
        console.error("fetchUpcomingStreamingReleases item failed:", r.reason);
      }
    }
  }

  results.sort(
    (a, b) =>
      new Date(a.release.release_date).getTime() -
      new Date(b.release.release_date).getTime()
  );
  return results;
}
