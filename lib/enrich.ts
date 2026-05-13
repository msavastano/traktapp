/**
 * Enrichment logic: takes raw watchlist items from Trakt and enriches
 * each with watch progress + computed tracking status.
 *
 * One API call per show: GET /shows/{slug}/progress/watched
 * (its embedded next_episode field supplies upcoming-episode data).
 */

import type {
  TraktWatchlistItem,
  TraktWatchedProgress,
  TraktEpisode,
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
  const progress = await fetchProgress(slug, accessToken);

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

  const { status, label } = computeTrackingStatus(item.show, progress);
  const nextEp = progress?.next_episode ?? null;

  return {
    listedAt: item.listed_at,
    show: item.show,
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
