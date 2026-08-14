/**
 * Enrichment logic: maps Simkl list items into the TrackedShow model.
 *
 * Fetching the list itself lives in lib/sync.ts, which is bound by Simkl's
 * activities-gate and date_from rules. This module only maps what that
 * returns, plus two public, CDN-cached lookups per show that fill in what the
 * library payload omits:
 *   GET /tv/{id}           — airing status, network, genres (for `completed`)
 *   GET /tv/episodes/{id}  — per-episode `aired` flags (for season breakdown)
 *
 * Both are heavily cached locally because show metadata changes rarely, so in
 * steady state a refresh is close to one request.
 */

import type {
  SimklListItem,
  SimklShow,
  TrackedShow,
  TrackingStatus,
  SeasonSummary,
  NextEpisodeInfo,

} from "./types";
import { fetchSimkl, apiUrl, baseHeaders } from "./simkl";
import { cacheGet, cacheSet } from "./cache";

/** Show metadata changes rarely — cache it far longer than the watchlist. */
const METADATA_TTL_MS = 24 * 60 * 60 * 1000;

interface SimklEpisodeRecord {
  title: string;
  season: number;
  episode: number;
  type: string; // "episode" | "special"
  aired: boolean;
  date?: string | null;
  runtime?: number;
  ids?: { simkl?: number };
}

// ---------------------------------------------------------------------------
// Remote lookups
// ---------------------------------------------------------------------------

// Library fetching lives in lib/sync.ts — it must go through the
// /sync/activities gate and use date_from deltas, so there is deliberately no
// "just fetch the library" helper exported from here.

async function fetchShowDetail(simklId: number): Promise<SimklShow | null> {
  const key = `show-detail:${simklId}`;
  const cached = cacheGet<SimklShow>(key);
  if (cached) return cached;

  try {
    const res = await fetchSimkl(apiUrl(`/tv/${simklId}`), {
      headers: baseHeaders(),
    });
    if (!res.ok) {
      console.warn(`fetchShowDetail ${simklId} -> ${res.status}`);
      return null;
    }
    const detail = await res.json();
    cacheSet(key, detail, METADATA_TTL_MS);
    return detail;
  } catch (err) {
    console.warn(`fetchShowDetail ${simklId} threw:`, err);
    return null;
  }
}

async function fetchEpisodes(
  simklId: number
): Promise<SimklEpisodeRecord[] | null> {
  const key = `show-episodes:${simklId}`;
  const cached = cacheGet<SimklEpisodeRecord[]>(key);
  if (cached) return cached;

  try {
    const res = await fetchSimkl(apiUrl(`/tv/episodes/${simklId}`), {
      headers: baseHeaders(),
    });
    if (!res.ok) {
      console.warn(`fetchEpisodes ${simklId} -> ${res.status}`);
      return null;
    }
    const episodes = await res.json();
    cacheSet(key, episodes, METADATA_TTL_MS);
    return episodes;
  } catch (err) {
    console.warn(`fetchEpisodes ${simklId} threw:`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

/** Parses Simkl's compact episode code, e.g. "S01E02" -> { season, episode }. */
function parseEpisodeCode(
  code: string | null | undefined
): { season: number; episode: number } | null {
  if (!code) return null;
  const match = /^S(\d+)E(\d+)$/i.exec(code.trim());
  if (!match) return null;
  return { season: Number(match[1]), episode: Number(match[2]) };
}

/**
 * Builds a stable synthetic episode id. Simkl addresses episodes by
 * (show, season, episode) on write endpoints rather than by id, so this value
 * is only ever used as a React key / optimistic-update map key.
 */
function synthEpisodeId(
  showId: number,
  season: number,
  episode: number
): number {
  return showId * 100_000 + season * 1_000 + episode;
}

function toEpisodeInfo(
  showId: number,
  season: number,
  episode: number,
  record: SimklEpisodeRecord | undefined,
  fallbackTitle: string | null,
  fallbackDate: string | null,
  fallbackRuntime?: number
): NextEpisodeInfo {
  const firstAired = record?.date ?? fallbackDate ?? null;
  return {
    id: synthEpisodeId(showId, season, episode),
    showId,
    season,
    episode,
    title: record?.title ?? fallbackTitle ?? `Episode ${episode}`,
    firstAired,
    // Prefer Simkl's own `aired` flag; fall back to comparing the date.
    isAired:
      record?.aired ?? (firstAired ? new Date(firstAired) <= new Date() : false),
    runtime: record?.runtime ?? fallbackRuntime,
  };
}

function computeTrackingStatus(
  showStatus: string | undefined,
  aired: number,
  completed: number,
  nextAirDate: string | null
): { status: TrackingStatus; label: string } {
  // Simkl reports these lowercase.
  const normalized = showStatus?.toLowerCase();
  const showEnded = normalized === "ended" || normalized === "canceled";

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
    const remaining = aired - completed;
    return {
      status: "behind",
      label: `${remaining} unwatched episode${remaining !== 1 ? "s" : ""}`,
    };
  }

  if (nextAirDate) {
    const airDate = new Date(nextAirDate);
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

// ---------------------------------------------------------------------------
// Enrichment
// ---------------------------------------------------------------------------

export async function enrichListItem(
  item: SimklListItem
): Promise<TrackedShow> {
  const simklId = item.show.ids.simkl;

  const [detail, episodes] = await Promise.all([
    fetchShowDetail(simklId),
    fetchEpisodes(simklId),
  ]);

  // The list item's show object carries only title/year/poster/ids, so merge
  // the detail record over it for status, network, genres and runtime.
  const show: SimklShow = { ...item.show, ...(detail ?? {}), ids: item.show.ids };

  // Simkl already gives us library-wide counts; trust them over recomputing,
  // since they account for specials and cross-mapped anime numbering.
  const completed = item.watched_episodes_count ?? 0;
  const aired = Math.max(
    0,
    (item.total_episodes_count ?? 0) - (item.not_aired_episodes_count ?? 0)
  );
  const unwatchedCount = Math.max(0, aired - completed);

  // Watched map: "season-episode" -> true.
  //
  // Season 0 is skipped: Simkl reports specials there (The Boys alone has 74),
  // and its own watched_episodes_count excludes them. Including them would add
  // dozens of bogus keys per show and could render a special as watched.
  const watchedEpisodes: Record<string, boolean> = {};
  for (const season of item.seasons ?? []) {
    if (season.number === 0) continue;
    for (const ep of season.episodes ?? []) {
      watchedEpisodes[`${season.number}-${ep.number}`] = true;
    }
  }

  // Per-season breakdown. Aired counts come from the episode list's `aired`
  // flags; specials (season 0) are excluded to match the previous behaviour.
  const realEpisodes = (episodes ?? []).filter(
    (e) => e.season > 0 && e.type !== "special"
  );
  const seasonNumbers = [...new Set(realEpisodes.map((e) => e.season))].sort(
    (a, b) => a - b
  );
  const seasons: SeasonSummary[] = seasonNumbers.map((number) => {
    const inSeason = realEpisodes.filter((e) => e.season === number);
    const airedCount = inSeason.filter((e) => e.aired).length;
    const completedCount = inSeason.filter(
      (e) => watchedEpisodes[`${number}-${e.episode}`]
    ).length;
    return {
      number,
      aired: airedCount,
      completed: completedCount,
      isFullyWatched: airedCount > 0 && completedCount >= airedCount,
    };
  });

  // The currently-releasing season: the highest season that has started airing
  // but still has unaired episodes scheduled.
  let upcomingInSeason: { season: number; remaining: number } | null = null;
  for (const number of [...seasonNumbers].reverse()) {
    const inSeason = realEpisodes.filter((e) => e.season === number);
    const airedCount = inSeason.filter((e) => e.aired).length;
    const remaining = inSeason.length - airedCount;
    if (airedCount > 0 && remaining > 0) {
      upcomingInSeason = { season: number, remaining };
      break;
    }
  }

  const episodeAt = (season: number, episode: number) =>
    realEpisodes.find((e) => e.season === season && e.episode === episode);

  // Next episode to watch: prefer the rich next_to_watch_info (only populated
  // for `watching` items), then fall back to parsing the compact code.
  const nextInfo = item.next_to_watch_info ?? null;
  const nextCoords =
    nextInfo != null
      ? { season: nextInfo.season, episode: nextInfo.episode }
      : parseEpisodeCode(item.next_to_watch);

  const nextEpisode = nextCoords
    ? toEpisodeInfo(
        simklId,
        nextCoords.season,
        nextCoords.episode,
        episodeAt(nextCoords.season, nextCoords.episode),
        nextInfo?.title ?? null,
        nextInfo?.date ?? null,
        show.runtime
      )
    : null;

  const lastCoords = parseEpisodeCode(item.last_watched);
  const lastEpisode = lastCoords
    ? toEpisodeInfo(
        simklId,
        lastCoords.season,
        lastCoords.episode,
        episodeAt(lastCoords.season, lastCoords.episode),
        null,
        null,
        show.runtime
      )
    : null;

  // The show's next globally-upcoming episode — the soonest unaired one,
  // regardless of where the user is in the run.
  const upcomingRecord = realEpisodes
    .filter((e) => !e.aired && e.date)
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))[0];
  const upcomingEpisode = upcomingRecord
    ? toEpisodeInfo(
        simklId,
        upcomingRecord.season,
        upcomingRecord.episode,
        upcomingRecord,
        null,
        null,
        show.runtime
      )
    : null;

  const { status, label } = computeTrackingStatus(
    show.status,
    aired,
    completed,
    upcomingEpisode?.firstAired ?? null
  );

  return {
    isEnriched: true,
    listedAt: item.added_to_watchlist_at ?? item.last_watched_at ?? "",
    show,
    progress: {
      aired,
      completed,
      unwatchedCount,
      percentWatched: aired > 0 ? Math.round((completed / aired) * 100) : 0,
      isFullyCaughtUp: completed >= aired,

      totalSeasons: seasons.length,
      seasons,

      lastWatchedAt: item.last_watched_at ?? null,
      lastEpisode,
      nextEpisode,
      upcomingEpisode,
      upcomingInSeason,
      watchedEpisodes,
    },
    trackingStatus: status,
    statusLabel: label,
  };
}

/**
 * Enriches a whole library.
 *
 * Concurrency stays low deliberately: Simkl caps apps at 10 GET/sec per
 * client_id and suspends keys that sustain overage without warning. The
 * per-show lookups are cached for a day, so warm runs barely touch the network.
 */
export async function enrichAll(
  items: SimklListItem[],
  concurrency = 4
): Promise<TrackedShow[]> {
  const results: TrackedShow[] = [];

  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const settled = await Promise.allSettled(batch.map(enrichListItem));
    for (const r of settled) {
      if (r.status === "fulfilled") {
        results.push(r.value);
      } else {
        console.error("enrichListItem failed:", r.reason);
      }
    }
  }

  return results;
}
