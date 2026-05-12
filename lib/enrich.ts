/**
 * Enrichment logic: takes raw watchlist items from Trakt and enriches
 * each with watch progress + computed tracking status.
 *
 * For each show, makes two additional API calls:
 *   1. GET /shows/{slug}/progress/watched  — user's per-episode progress
 *   2. GET /shows/{slug}/next_episode?extended=full — globally upcoming episode
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

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

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

async function fetchNextEpisode(
  slug: string,
  accessToken: string
): Promise<TraktEpisode | null> {
  try {
    const res = await fetch(
      `${TRAKT_API_BASE}/shows/${slug}/next_episode?extended=full`,
      { headers: apiHeaders(accessToken), cache: "no-store" }
    );
    if (res.status === 204) return null;
    if (!res.ok) {
      console.warn(`fetchNextEpisode ${slug} -> ${res.status}`);
      return null;
    }
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as TraktEpisode;
  } catch (err) {
    console.warn(`fetchNextEpisode ${slug} threw:`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Enrichment
// ---------------------------------------------------------------------------

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
  progress: TraktWatchedProgress | null,
  upcomingEpisode: TraktEpisode | null
): { status: TrackingStatus; label: string } {
  const showEnded =
    show.status === "ended" || show.status === "canceled";
  const aired = progress?.aired ?? 0;
  const completed = progress?.completed ?? 0;

  // Never watched
  if (completed === 0) {
    return {
      status: "not_started",
      label: `Not started · ${aired} episodes aired`,
    };
  }

  const caughtUp = completed >= aired;

  // Finished show + caught up
  if (showEnded && caughtUp) {
    return {
      status: "completed",
      label: `Completed · All ${completed} episodes watched`,
    };
  }

  // NOT caught up (whether show is ended or ongoing)
  if (!caughtUp) {
    return {
      status: "behind",
      label: `${aired - completed} unwatched episode${aired - completed !== 1 ? "s" : ""}`,
    };
  }

  // Ongoing show + caught up — check for upcoming episodes
  if (upcomingEpisode?.first_aired) {
    const airDate = new Date(upcomingEpisode.first_aired);
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

  // Caught up but no known upcoming episode
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

  // Fetch progress and upcoming episode in parallel
  const [progress, upcomingEpisode] = await Promise.all([
    fetchProgress(slug, accessToken),
    fetchNextEpisode(slug, accessToken),
  ]);

  const aired = progress?.aired ?? 0;
  const completed = progress?.completed ?? 0;
  const unwatchedCount = Math.max(0, aired - completed);

  // Build per-season summaries (exclude specials — season 0)
  const seasons: SeasonSummary[] = (progress?.seasons ?? [])
    .filter((s) => s.number > 0)
    .map((s) => ({
      number: s.number,
      aired: s.aired,
      completed: s.completed,
      isFullyWatched: s.completed >= s.aired,
    }));

  const { status, label } = computeTrackingStatus(
    item.show,
    progress,
    upcomingEpisode
  );

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
      nextEpisode: toNextEpisodeInfo(progress?.next_episode ?? null),
      upcomingEpisode: toNextEpisodeInfo(upcomingEpisode),
    },
    trackingStatus: status,
    statusLabel: label,
  };
}

/**
 * Enriches an entire watchlist in parallel (with concurrency limit).
 */
export async function enrichWatchlist(
  items: TraktWatchlistItem[],
  accessToken: string,
  concurrency = 5
): Promise<TrackedShow[]> {
  const results: TrackedShow[] = [];

  // Process in batches to avoid overwhelming the API.
  // allSettled so one show's failure doesn't reject the whole batch.
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
