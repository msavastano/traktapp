import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  decodeTokens,
  isTokenExpired,
  refreshAccessToken,
  encodeTokens,
  COOKIE_NAME,
} from "@/lib/trakt";
import { cacheDelete, watchlistKey } from "@/lib/cache";

const TRAKT_API_BASE = "https://api.trakt.tv";
const USER_AGENT = "TraktApp/1.0 (Next.js; +http://localhost:3000)";

/**
 * POST /api/history
 *
 * Marks watched in the user's Trakt history. Body shapes:
 *   { episodeId: number }                    — one episode
 *   { showId: number, season: number }       — entire season of a show
 *   { showId: number }                       — entire show (every aired episode)
 */
export async function POST(req: Request) {
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

  // Auto-refresh if expired
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

  try {
    const { episodeId, showId, season } = await req.json();

    let payload: Record<string, unknown>;

    if (episodeId) {
      payload = { episodes: [{ ids: { trakt: episodeId } }] };
    } else if (showId && typeof season === "number") {
      payload = {
        shows: [
          { ids: { trakt: showId }, seasons: [{ number: season }] },
        ],
      };
    } else if (showId) {
      payload = { shows: [{ ids: { trakt: showId } }] };
    } else {
      return NextResponse.json(
        { error: "episodeId or showId is required" },
        { status: 400 }
      );
    }

    const res = await fetch(`${TRAKT_API_BASE}/sync/history`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        "trakt-api-key": process.env.TRAKT_CLIENT_ID!,
        "trakt-api-version": "2",
        Authorization: `Bearer ${tokens.access_token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`Sync history failed (${res.status}):`, text);
      return NextResponse.json(
        { error: "Failed to mark as watched" },
        { status: res.status }
      );
    }

    const data = await res.json();
    cacheDelete(watchlistKey(tokens.access_token));
    return NextResponse.json(data);
  } catch (error) {
    console.error("Sync history error:", error);
    return NextResponse.json(
      { error: "Failed to mark as watched" },
      { status: 500 }
    );
  }
}
