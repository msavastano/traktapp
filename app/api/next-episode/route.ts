import { NextResponse } from "next/server";
import { fetchSimkl, apiUrl, baseHeaders } from "@/lib/simkl";
import { getSession } from "@/lib/session";
import { cacheGet, cacheSet } from "@/lib/cache";
import type { NextEpisodeInfo } from "@/lib/types";

/** Matches the episode records returned by GET /tv/episodes/{id}. */
interface SimklEpisodeRecord {
  title: string;
  season: number;
  episode: number;
  type: string;
  aired: boolean;
  date?: string | null;
  runtime?: number;
}

const METADATA_TTL_MS = 24 * 60 * 60 * 1000;

function toNextEpisodeInfo(
  showId: number,
  ep: SimklEpisodeRecord
): NextEpisodeInfo {
  const firstAired = ep.date ?? null;
  return {
    // Synthetic — see NextEpisodeInfo in lib/types.ts. Never sent to the API.
    id: showId * 100_000 + ep.season * 1_000 + ep.episode,
    showId,
    season: ep.season,
    episode: ep.episode,
    title: ep.title,
    firstAired,
    isAired: ep.aired ?? (firstAired ? new Date(firstAired) <= new Date() : false),
    runtime: ep.runtime ?? undefined,
  };
}

/**
 * Simkl returns the show's entire episode list in one call, so unlike the
 * Trakt version there's no per-season fetching or "try the next season" walk.
 */
async function fetchEpisodes(
  showId: number
): Promise<SimklEpisodeRecord[] | null> {
  const key = `show-episodes:${showId}`;
  const cached = cacheGet<SimklEpisodeRecord[]>(key);
  if (cached) return cached;

  const res = await fetchSimkl(apiUrl(`/tv/episodes/${showId}`), {
    headers: baseHeaders(),
  });
  if (!res.ok) return null;
  const episodes = await res.json();
  cacheSet(key, episodes, METADATA_TTL_MS);
  return episodes;
}

/**
 * GET /api/next-episode?showId=<simkl id>&season=<n>&episode=<n>
 *
 * Returns the episode that follows the given (season, episode) for the show.
 * Used by the dashboard's skip feature to advance past a skipped episode,
 * since skips aren't persisted on Simkl.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session.ok) return session.response;

  const url = new URL(req.url);
  const showIdStr = url.searchParams.get("showId");
  const seasonStr = url.searchParams.get("season");
  const episodeStr = url.searchParams.get("episode");

  if (!showIdStr || !seasonStr || !episodeStr) {
    return NextResponse.json(
      { error: "showId, season, episode required" },
      { status: 400 }
    );
  }

  const showId = Number(showIdStr);
  const season = Number(seasonStr);
  const episode = Number(episodeStr);
  if (![showId, season, episode].every(Number.isFinite)) {
    return NextResponse.json(
      { error: "invalid showId/season/episode" },
      { status: 400 }
    );
  }

  try {
    const episodes = await fetchEpisodes(showId);
    if (!episodes) return NextResponse.json({ next: null });

    // Specials (season 0) are excluded so skipping never lands on one.
    const ordered = episodes
      .filter((e) => e.season > 0 && e.type !== "special")
      .sort((a, b) => a.season - b.season || a.episode - b.episode);

    const idx = ordered.findIndex(
      (e) => e.season === season && e.episode === episode
    );

    // Unknown current episode: fall back to the first one that sorts after it,
    // which also covers the next-season rollover the Trakt version did by hand.
    const next =
      idx >= 0
        ? ordered[idx + 1]
        : ordered.find(
            (e) => e.season > season || (e.season === season && e.episode > episode)
          );

    return NextResponse.json({
      next: next ? toNextEpisodeInfo(showId, next) : null,
    });
  } catch (err) {
    console.error("next-episode error:", err);
    return NextResponse.json(
      { error: "Failed to fetch next episode" },
      { status: 500 }
    );
  }
}
