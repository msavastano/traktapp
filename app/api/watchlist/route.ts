import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  decodeTokens,
  isTokenExpired,
  refreshAccessToken,
  encodeTokens,
  COOKIE_NAME,
} from "@/lib/trakt";
import { enrichWatchlist } from "@/lib/enrich";
import { cacheGet, cacheSet, cacheDelete, watchlistKey } from "@/lib/cache";
import type { TrackedShow } from "@/lib/types";

interface WatchlistPayload {
  shows: TrackedShow[];
  pagination: {
    page: string | null;
    limit: string | null;
    pageCount: string | null;
    itemCount: string;
  };
}

const TRAKT_API_BASE = "https://api.trakt.tv";
const USER_AGENT = "TraktApp/1.0 (Next.js; +http://localhost:3000)";

/**
 * GET /api/watchlist
 *
 * Returns the authenticated user's TV show watchlist enriched with:
 *   - Per-show watch progress (aired vs completed)
 *   - Per-season breakdown
 *   - Next/upcoming episode info
 *   - Computed tracking status
 */
export async function GET() {
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
    const cacheKey = watchlistKey(tokens.access_token);
    const cached = cacheGet<WatchlistPayload>(cacheKey);
    if (cached) {
      return NextResponse.json(cached, { headers: { "x-cache": "HIT" } });
    }

    const headers = {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      "trakt-api-key": process.env.TRAKT_CLIENT_ID!,
      "trakt-api-version": "2",
      Authorization: `Bearer ${tokens.access_token}`,
    };

    // Step 1: Fetch the raw watchlist AND watched shows with extended info
    const [watchlistRes, watchedRes] = await Promise.all([
      fetch(
        `${TRAKT_API_BASE}/users/me/watchlist/shows?page=1&limit=100&extended=full,images`,
        { headers }
      ),
      fetch(
        `${TRAKT_API_BASE}/sync/watched/shows?page=1&limit=100&extended=full,images`,
        { headers }
      )
    ]);

    if (!watchlistRes.ok) {
      const text = await watchlistRes.text();
      console.error(`Watchlist fetch failed (${watchlistRes.status}):`, text);
      return NextResponse.json(
        { error: "Failed to fetch watchlist" },
        { status: watchlistRes.status }
      );
    }
    
    if (!watchedRes.ok) {
      const text = await watchedRes.text();
      console.error(`Watched fetch failed (${watchedRes.status}):`, text);
      return NextResponse.json(
        { error: "Failed to fetch watched shows" },
        { status: watchedRes.status }
      );
    }

    const rawWatchlist = await watchlistRes.json();
    const rawWatched = await watchedRes.json();

    // Map watched items to the same structure as watchlist items
    const mappedWatched = rawWatched.map((item: any) => ({
      listed_at: item.last_watched_at || item.last_updated_at || new Date().toISOString(),
      type: "show",
      show: item.show,
    }));

    // Combine them, deduplicating by Trakt ID
    const showMap = new Map<number, any>();
    
    for (const item of rawWatchlist) {
      if (item.show?.ids?.trakt) {
        showMap.set(item.show.ids.trakt, item);
      }
    }
    
    for (const item of mappedWatched) {
      if (item.show?.ids?.trakt) {
        showMap.set(item.show.ids.trakt, item);
      }
    }

    const combinedList = Array.from(showMap.values());

    // Sort combined list by listed_at/last_watched_at descending
    combinedList.sort((a, b) => new Date(b.listed_at).getTime() - new Date(a.listed_at).getTime());

    // Step 2: Enrich each show with progress + tracking status
    const enriched = await enrichWatchlist(combinedList, tokens.access_token);

    const payload: WatchlistPayload = {
      shows: enriched,
      pagination: {
        page: watchlistRes.headers.get("x-pagination-page"),
        limit: watchlistRes.headers.get("x-pagination-limit"),
        pageCount: watchlistRes.headers.get("x-pagination-page-count"),
        itemCount: String(combinedList.length),
      },
    };
    cacheSet(cacheKey, payload);

    return NextResponse.json(payload, { headers: { "x-cache": "MISS" } });
  } catch (error) {
    console.error("Watchlist fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch watchlist" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/watchlist
 *
 * Adds a show to the user's Trakt watchlist.
 * Body: { showId: number } — Trakt show id.
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
    const { showId } = await req.json();
    if (!showId) {
      return NextResponse.json({ error: "showId is required" }, { status: 400 });
    }

    const res = await fetch(`${TRAKT_API_BASE}/sync/watchlist`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        "trakt-api-key": process.env.TRAKT_CLIENT_ID!,
        "trakt-api-version": "2",
        Authorization: `Bearer ${tokens.access_token}`,
      },
      body: JSON.stringify({
        shows: [{ ids: { trakt: showId } }],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`Add to watchlist failed (${res.status}):`, text);
      return NextResponse.json(
        { error: "Failed to add to watchlist" },
        { status: res.status }
      );
    }

    const data = await res.json();
    cacheDelete(watchlistKey(tokens.access_token));
    return NextResponse.json(data);
  } catch (error) {
    console.error("Add to watchlist error:", error);
    return NextResponse.json(
      { error: "Failed to add to watchlist" },
      { status: 500 }
    );
  }
}
