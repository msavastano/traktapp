/**
 * Enrichment logic: takes raw watchlist items from Trakt and enriches
 * each with watch progress + computed tracking status.
 *
 * Two API calls per show (parallel):
 *   GET /shows/{slug}/progress/watched
 *   GET /shows/{slug}/seasons?extended=full  (for episode_count per season,
 *     so we can compute episodes-remaining-in-current-season)
 */

import type {
  TraktWatchlistItem,
  TraktWatchedProgress,
  TraktEpisode,
  TraktImages,
  TrackedShow,
  TrackingStatus,
  SeasonSummary,
  NextEpisodeInfo,
} from "./types";

const TRAKT_API_BASE = "https://api.trakt.tv";
const USER_AGENT = "TraktApp/1.0 (Next.js; +http://localhost:3000)";

function apiHeaders(accessToken: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    "trakt-api-key": process.env.TRAKT_CLIENT_ID!,
    "trakt-api-version": "2",
    Authorization: `Bearer ${accessToken}`,
  };
}

interface TraktSeasonInfo {
  number: number;
  episode_count: number;
  aired_episodes: number;
  first_aired?: string | null;
}

async function fetchSeasons(
  slug: string,
  accessToken: string
): Promise<TraktSeasonInfo[] | null> {
  try {
    const res = await fetch(
      `${TRAKT_API_BASE}/shows/${slug}/seasons?extended=full`,
      { headers: apiHeaders(accessToken), cache: "no-store" }
    );
    if (!res.ok) {
      console.warn(`fetchSeasons ${slug} -> ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn(`fetchSeasons ${slug} threw:`, err);
    return null;
  }
}

async function fetchShowImages(
  slug: string,
  accessToken: string
): Promise<TraktImages | null> {
  try {
    const res = await fetch(
      `${TRAKT_API_BASE}/shows/${slug}?extended=images`,
      { headers: apiHeaders(accessToken), cache: "no-store" }
    );
    if (!res.ok) {
      console.warn(`fetchShowImages ${slug} -> ${res.status}`);
      return null;
    }
    const data = await res.json();
    return data?.images ?? null;
  } catch (err) {
    console.warn(`fetchShowImages ${slug} threw:`, err);
    return null;
  }
}

async function fetchProgress(
  slug: string,
  accessToken: string
): Promise<TraktWatchedProgress | null> {
  try {
    const res = await fetch(
      `${TRAKT_API_BASE}/shows/${slug}/progress/watched?hidden=false&specials=false&count_specials=false`,
      { headers: apiHeaders(accessToken), cache: "no-store" }
    );
    if (!res.ok) {
      console.warn(`fetchProgress ${slug} -> ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn(`fetchProgress ${slug} threw:`, err);
    return null;
  }
}

function toNextEpisodeInfo(ep: TraktEpisode | null): NextEpisodeInfo | null {
  if (!ep) return null;
  const firstAired = ep.first_aired ?? null;
  return {
    id: ep.ids.trakt,
    season: ep.season,
    episode: ep.number,
    title: ep.title,
    firstAired,
    isAired: firstAired ? new Date(firstAired) <= new Date() : false,
  };
}

function computeTrackingStatus(
  show: TraktWatchlistItem["show"],
  progress: TraktWatchedProgress | null
): { status: TrackingStatus; label: string } {
  const showEnded =
    show.status === "ended" || show.status === "canceled";
  const aired = progress?.aired ?? 0;
  const completed = progress?.completed ?? 0;

  if (completed === 0) {
    return {
      status: "not_started",
      label: `Not started · ${aired} episodes aired`,
    };
  }

  const caughtUp = completed >= aired;

  if (showEnded && caughtUp) {
    return {
      status: "completed",
      label: `Completed · All ${completed} episodes watched`,
    };
  }

  if (!caughtUp) {
    return {
      status: "behind",
      label: `${aired - completed} unwatched episode${aired - completed !== 1 ? "s" : ""}`,
    };
  }

  const upcomingAirDate = progress?.next_episode?.first_aired ?? null;
  if (upcomingAirDate) {
    const airDate = new Date(upcomingAirDate);
    if (airDate > new Date()) {
      const formatted = airDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      return {
        status: "waiting_new_episodes",
        label: `Caught up · Next episode ${formatted}`,
      };
    }
  }

  return {
    status: "waiting_new_season",
    label: "Caught up · Waiting for new season",
  };
}

export async function enrichWatchlistItem(
  item: TraktWatchlistItem,
  accessToken: string
): Promise<TrackedShow> {
  const slug = item.show.ids.slug;
  const needsImages = !item.show.images?.poster?.length;
  const [progress, seasonsRaw, images] = await Promise.all([
    fetchProgress(slug, accessToken),
    fetchSeasons(slug, accessToken),
    needsImages ? fetchShowImages(slug, accessToken) : Promise.resolve(null),
  ]);
  const show = images ? { ...item.show, images } : item.show;

  const aired = progress?.aired ?? 0;
  const completed = progress?.completed ?? 0;
  const unwatchedCount = Math.max(0, aired - completed);

  const seasons: SeasonSummary[] = (progress?.seasons ?? [])
    .filter((s) => s.number > 0)
    .map((s) => ({
      number: s.number,
      aired: s.aired,
      completed: s.completed,
      isFullyWatched: s.completed >= s.aired,
    }));

  // Find the currently-releasing season: a season that has started airing
  // (aired_episodes > 0) but isn't fully aired yet. Skips seasons that
  // haven't begun (aired_episodes === 0 — entire season is "left", which is
  // not useful info) and fully-aired seasons. Excludes specials.
  let upcomingInSeason: { season: number; remaining: number } | null = null;
  if (seasonsRaw) {
    const partial = seasonsRaw
      .filter(
        (s) =>
          s.number > 0 &&
          s.episode_count > 0 &&
          s.aired_episodes > 0 &&
          s.aired_episodes < s.episode_count
      )
      .sort((a, b) => b.number - a.number);
    const target = partial[0];
    if (target) {
      upcomingInSeason = {
        season: target.number,
        remaining: target.episode_count - target.aired_episodes,
      };
    }
  }

  const { status, label } = computeTrackingStatus(show, progress);
  // Trakt sometimes returns placeholder next-episode entries for future
  // seasons (no first_aired, title like "Episode #2.1"). Drop them — they're
  // not real scheduled episodes and shouldn't appear as "Next to watch".
  const rawNext = progress?.next_episode ?? null;
  const nextEp = rawNext && rawNext.first_aired ? rawNext : null;

  return {
    listedAt: item.listed_at,
    show,
    progress: {
      aired,
      completed,
      unwatchedCount,
      percentWatched: aired > 0 ? Math.round((completed / aired) * 100) : 0,
      isFullyCaughtUp: completed >= aired,

      totalSeasons: seasons.length,
      seasons,

      lastWatchedAt: progress?.last_watched_at ?? null,
      lastEpisode: toNextEpisodeInfo(progress?.last_episode ?? null),
      nextEpisode: toNextEpisodeInfo(nextEp),
      upcomingEpisode: toNextEpisodeInfo(nextEp),
      upcomingInSeason,
    },
    trackingStatus: status,
    statusLabel: label,
  };
}

export async function enrichWatchlist(
  items: TraktWatchlistItem[],
  accessToken: string,
  concurrency = 8
): Promise<TrackedShow[]> {
  const results: TrackedShow[] = [];

  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map((item) => enrichWatchlistItem(item, accessToken))
    );
    for (const r of settled) {
      if (r.status === "fulfilled") {
        results.push(r.value);
      } else {
        console.error("enrichWatchlistItem failed:", r.reason);
      }
    }
  }

  return results;
}
