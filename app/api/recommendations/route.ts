import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  decodeTokens,
  isTokenExpired,
  refreshAccessToken,
  encodeTokens,
  COOKIE_NAME,
  fetchTrakt,
} from "@/lib/trakt";
import { generateRecommendations, TasteShow, GeminiRecommendation } from "@/lib/gemini";
import type { TraktShow } from "@/lib/types";

const TRAKT_API_BASE = "https://api.trakt.tv";
const USER_AGENT = "TraktApp/1.0 (Next.js; +http://localhost:3000)";

export interface RecommendationCard extends GeminiRecommendation {
  show: TraktShow | null;
}

interface CacheEntry {
  generatedAt: number;
  results: RecommendationCard[];
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour soft TTL; per-session caching

export async function GET(req: NextRequest) {
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

  const force = req.nextUrl.searchParams.get("refresh") === "1";
  const cacheKey = tokens.access_token;

  if (!force) {
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.generatedAt < CACHE_TTL_MS) {
      return NextResponse.json({
        recommendations: cached.results,
        cached: true,
        generatedAt: cached.generatedAt,
      });
    }
  }

  const headers = {
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    "trakt-api-key": process.env.TRAKT_CLIENT_ID!,
    "trakt-api-version": "2",
    Authorization: `Bearer ${tokens.access_token}`,
  };

  try {
    const [watchlistRes, watchedRes] = await Promise.all([
      fetchTrakt(`${TRAKT_API_BASE}/users/me/watchlist/shows?page=1&limit=100&extended=full`, { headers }),
      fetchTrakt(`${TRAKT_API_BASE}/sync/watched/shows?page=1&limit=100&extended=full`, { headers }),
    ]);

    if (!watchlistRes.ok || !watchedRes.ok) {
      return NextResponse.json({ error: "Failed to fetch taste data" }, { status: 500 });
    }

    const rawWatchlist = await watchlistRes.json();
    const rawWatched = await watchedRes.json();

    const taste: TasteShow[] = [];
    const seen = new Set<number>();

    for (const item of rawWatched) {
      const s = item.show;
      if (!s?.ids?.trakt || seen.has(s.ids.trakt)) continue;
      seen.add(s.ids.trakt);
      taste.push({
        title: s.title,
        year: s.year,
        genres: s.genres,
        rating: s.rating,
        status: s.status,
        watched: true,
      });
    }
    for (const item of rawWatchlist) {
      const s = item.show;
      if (!s?.ids?.trakt || seen.has(s.ids.trakt)) continue;
      seen.add(s.ids.trakt);
      taste.push({
        title: s.title,
        year: s.year,
        genres: s.genres,
        rating: s.rating,
        status: s.status,
        watched: false,
      });
    }

    if (taste.length === 0) {
      return NextResponse.json({
        recommendations: [],
        cached: false,
        generatedAt: Date.now(),
        empty: true,
      });
    }

    const recs = await generateRecommendations(taste, 12);

    // Enrich each rec with Trakt show data (poster, ids, etc.)
    const excludedTitles = new Set(taste.map((t) => t.title.toLowerCase()));
    const enriched: RecommendationCard[] = await Promise.all(
      recs.map(async (rec) => {
        try {
          const params = new URLSearchParams({
            query: rec.title,
            extended: "full,images",
            limit: "5",
          });
          const res = await fetchTrakt(
            `${TRAKT_API_BASE}/search/show?${params.toString()}`,
            { headers }
          );
          if (!res.ok) return { ...rec, show: null };
          const results = (await res.json()) as Array<{ show: TraktShow }>;
          // Prefer exact title match (case-insensitive); fall back to first.
          const lowerTitle = rec.title.toLowerCase();
          const match =
            results.find(
              (r) =>
                r.show?.title?.toLowerCase() === lowerTitle &&
                (!rec.year || r.show?.year === rec.year)
            ) ??
            results.find((r) => r.show?.title?.toLowerCase() === lowerTitle) ??
            results[0];
          const show = match?.show ?? null;
          // Drop if it ended up matching something already in the user's lists.
          if (show && excludedTitles.has(show.title.toLowerCase())) {
            return { ...rec, show: null };
          }
          return { ...rec, show };
        } catch {
          return { ...rec, show: null };
        }
      })
    );

    cache.set(cacheKey, { generatedAt: Date.now(), results: enriched });

    return NextResponse.json({
      recommendations: enriched,
      cached: false,
      generatedAt: Date.now(),
    });
  } catch (error) {
    console.error("Recommendations error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to generate recommendations", detail: message },
      { status: 500 }
    );
  }
}
