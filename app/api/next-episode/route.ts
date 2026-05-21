import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  decodeTokens,
  isTokenExpired,
  refreshAccessToken,
  encodeTokens,
  COOKIE_NAME,
  fetchTrakt,
} from "@/lib/trakt";
import type { NextEpisodeInfo, TraktEpisode } from "@/lib/types";

const TRAKT_API_BASE = "https://api.trakt.tv";
const USER_AGENT = "TraktApp/1.0 (Next.js; +http://localhost:3000)";

function toNextEpisodeInfo(ep: TraktEpisode): NextEpisodeInfo {
  const firstAired = ep.first_aired ?? null;
  return {
    id: ep.ids.trakt,
    season: ep.season,
    episode: ep.number,
    title: ep.title,
    firstAired,
    isAired: firstAired ? new Date(firstAired) <= new Date() : false,
    runtime: ep.runtime ?? undefined,
  };
}

async function fetchSeasonEpisodes(
  slug: string,
  season: number,
  accessToken: string
): Promise<TraktEpisode[] | null> {
  const res = await fetchTrakt(
    `${TRAKT_API_BASE}/shows/${slug}/seasons/${season}?extended=full`,
    {
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        "trakt-api-key": process.env.TRAKT_CLIENT_ID!,
        "trakt-api-version": "2",
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    }
  );
  if (!res.ok) return null;
  return res.json();
}

/**
 * GET /api/next-episode?slug=<show-slug>&season=<n>&episode=<n>
 *
 * Returns the episode that follows the given (season, episode) for the show.
 * Used by the dashboard's skip feature to advance to the next episode after
 * skipping one (since skips aren't persisted on Trakt).
 */
export async function GET(req: Request) {
  const cookieStore = await cookies();
  const encoded = cookieStore.get(COOKIE_NAME)?.value;

  if (!encoded) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let tokens = decodeTokens(encoded);
  if (!tokens) {
    cookieStore.delete(COOKIE_NAME);
    return NextResponse.json({ error: "Invalid token data" }, { status: 401 });
  }

  if (isTokenExpired(tokens)) {
    try {
      tokens = await refreshAccessToken(tokens.refresh_token);
      cookieStore.set(COOKIE_NAME, encodeTokens(tokens), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 90 * 24 * 60 * 60,
        path: "/",
      });
    } catch {
      cookieStore.delete(COOKIE_NAME);
      return NextResponse.json({ user: null }, { status: 401 });
    }
  }

  const url = new URL(req.url);
  const slug = url.searchParams.get("slug");
  const seasonStr = url.searchParams.get("season");
  const episodeStr = url.searchParams.get("episode");

  if (!slug || !seasonStr || !episodeStr) {
    return NextResponse.json(
      { error: "slug, season, episode required" },
      { status: 400 }
    );
  }

  const season = Number(seasonStr);
  const episode = Number(episodeStr);
  if (!Number.isFinite(season) || !Number.isFinite(episode)) {
    return NextResponse.json({ error: "invalid season/episode" }, { status: 400 });
  }

  try {
    const current = await fetchSeasonEpisodes(slug, season, tokens.access_token);
    if (current) {
      const sameSeasonNext = current.find((e) => e.number === episode + 1);
      if (sameSeasonNext) {
        return NextResponse.json({ next: toNextEpisodeInfo(sameSeasonNext) });
      }
    }

    // Try next season's episode 1
    const nextSeason = await fetchSeasonEpisodes(
      slug,
      season + 1,
      tokens.access_token
    );
    if (nextSeason && nextSeason.length > 0) {
      const ep1 =
        nextSeason.find((e) => e.number === 1) ?? nextSeason[0];
      return NextResponse.json({ next: toNextEpisodeInfo(ep1) });
    }

    return NextResponse.json({ next: null });
  } catch (err) {
    console.error("next-episode error:", err);
    return NextResponse.json(
      { error: "Failed to fetch next episode" },
      { status: 500 }
    );
  }
}
