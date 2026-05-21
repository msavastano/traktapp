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
import { cacheDelete, watchlistKey } from "@/lib/cache";

const TRAKT_API_BASE = "https://api.trakt.tv";
const USER_AGENT = "TraktApp/1.0 (Next.js; +http://localhost:3000)";

async function getValidTokens() {
  const cookieStore = await cookies();
  const encoded = cookieStore.get(COOKIE_NAME)?.value;
  if (!encoded) return { error: "Not authenticated", status: 401 as const };

  let tokens = decodeTokens(encoded);
  if (!tokens) {
    cookieStore.delete(COOKIE_NAME);
    return { error: "Invalid token data", status: 401 as const };
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
      return { error: "Token refresh failed", status: 401 as const };
    }
  }

  return { tokens };
}

function buildPayload(body: {
  episodeId?: number;
  showId?: number;
  season?: number;
}) {
  const { episodeId, showId, season } = body;
  if (episodeId) return { episodes: [{ ids: { trakt: episodeId } }] };
  if (showId && typeof season === "number") {
    return { shows: [{ ids: { trakt: showId }, seasons: [{ number: season }] }] };
  }
  if (showId) return { shows: [{ ids: { trakt: showId } }] };
  return null;
}

/**
 * POST /api/history — marks watched.
 * DELETE /api/history — removes from history (unwatch).
 *
 * Body shapes (both methods):
 *   { episodeId: number }                    — one episode
 *   { showId: number, season: number }       — entire season of a show
 *   { showId: number }                       — entire show (every aired episode)
 */
export async function POST(req: Request) {
  return handleHistory(req, "add");
}

export async function DELETE(req: Request) {
  return handleHistory(req, "remove");
}

async function handleHistory(req: Request, action: "add" | "remove") {
  const auth = await getValidTokens();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { tokens } = auth;

  try {
    const body = await req.json();
    const payload = buildPayload(body);
    if (!payload) {
      return NextResponse.json(
        { error: "episodeId or showId is required" },
        { status: 400 }
      );
    }

    const url =
      action === "add"
        ? `${TRAKT_API_BASE}/sync/history`
        : `${TRAKT_API_BASE}/sync/history/remove`;

    const res = await fetchTrakt(url, {
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
      console.error(`Sync history ${action} failed (${res.status}):`, text);
      return NextResponse.json(
        { error: action === "add" ? "Failed to mark as watched" : "Failed to unwatch" },
        { status: res.status }
      );
    }

    const data = await res.json();
    cacheDelete(watchlistKey(tokens.access_token));
    return NextResponse.json(data);
  } catch (error) {
    console.error(`Sync history ${action} error:`, error);
    return NextResponse.json(
      { error: action === "add" ? "Failed to mark as watched" : "Failed to unwatch" },
      { status: 500 }
    );
  }
}
