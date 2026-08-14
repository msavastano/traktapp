/**
 * Upcoming movie releases, from Simkl's CDN movie-release calendar.
 *
 * ⚠️ Behaviour change from the Trakt implementation.
 *
 * Trakt exposed per-country release *types* (`digital`, `tv`, `theatrical`, …)
 * with a `note` field that often named the streaming service, so the old code
 * could heuristically answer "what's about to hit streaming?".
 *
 * Simkl's calendar carries no release-type breakdown — an entry is just
 * `{simkl_id, date}` joined to show metadata. So this now answers the weaker
 * question "what's releasing soon?", and the UI wording should match. The
 * metadata does include a `dvd_date`, but that is a physical-release date and
 * is not a reliable streaming signal.
 */

import type { SimklMovie, UpcomingStreamingRelease } from "./types";
import { fetchSimkl, cdnUrl, baseHeaders } from "./simkl";

interface MovieFeedEntry {
  simkl_id: number;
  date: string;
}

interface MovieFeedMeta {
  title: string;
  poster?: string;
  ids?: { simkl_id?: number; slug?: string; imdb?: string; tmdb?: string };
  release_date?: string;
  runtime?: string | number;
  genres?: string[];
  ratings?: { simkl?: { rating?: number; votes?: number } };
}

interface MovieFeed {
  calendar: MovieFeedEntry[];
  metadata: Record<string, MovieFeedMeta>;
}

/** Simkl reports runtime as either a number or a string like "28m". */
function parseRuntime(value: string | number | undefined): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const m = /(\d+)/.exec(value);
    if (m) return Number(m[1]);
  }
  return undefined;
}

function toMovie(simklId: number, meta: MovieFeedMeta | undefined): SimklMovie {
  return {
    title: meta?.title ?? "",
    year: meta?.release_date
      ? new Date(meta.release_date).getUTCFullYear()
      : null,
    ids: {
      simkl: simklId,
      slug: meta?.ids?.slug,
      imdb: meta?.ids?.imdb ?? null,
      tmdb: meta?.ids?.tmdb ?? null,
    },
    poster: meta?.poster ?? null,
    runtime: parseRuntime(meta?.runtime),
    genres: meta?.genres,
    rating: meta?.ratings?.simkl?.rating,
    votes: meta?.ratings?.simkl?.votes,
    released: meta?.release_date ?? null,
  };
}

/**
 * Movies releasing from today onward, soonest first.
 *
 * The feed is a rolling ~33-day window and is identical for every user, so
 * the caller is expected to cache the result rather than this refetching.
 */
export async function fetchUpcomingMovieReleases(
  limit = 40
): Promise<UpcomingStreamingRelease[]> {
  const res = await fetchSimkl(cdnUrl("/calendar/v2/movie_release.json"), {
    headers: baseHeaders(),
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch movie release calendar (${res.status})`);
  }

  const feed: MovieFeed = await res.json();
  if (!feed?.calendar) return [];

  // Compare against the start of today so a release earlier today still shows.
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);

  return feed.calendar
    .filter((entry) => entry.date && new Date(entry.date) >= startOfToday)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, limit)
    .map((entry) => ({
      movie: toMovie(entry.simkl_id, feed.metadata?.[String(entry.simkl_id)]),
      releaseDate: entry.date,
    }))
    .filter((r) => r.movie.title !== "");
}
