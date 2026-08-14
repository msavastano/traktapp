import { NextRequest, NextResponse } from "next/server";
import { fetchSimkl, apiUrl, baseHeaders, normalizeShow } from "@/lib/simkl";
import { getSession } from "@/lib/session";
import { syncLibrary } from "@/lib/sync";
import { generateRecommendations, TasteShow, GeminiRecommendation } from "@/lib/gemini";
import { GEMINI_KEY_HEADER, MISSING_KEY_ERROR } from "@/lib/gemini-key";
import type { SimklShow } from "@/lib/types";

export interface RecommendationCard extends GeminiRecommendation {
  show: SimklShow | null;
}

interface CacheEntry {
  generatedAt: number;
  results: RecommendationCard[];
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour soft TTL; per-session caching

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session.ok) return session.response;
  const { tokens } = session;

  const geminiKey = req.headers.get(GEMINI_KEY_HEADER)?.trim();
  if (!geminiKey) {
    return NextResponse.json(
      { error: MISSING_KEY_ERROR, detail: "Add your Gemini API key to get AI recommendations." },
      { status: 400 }
    );
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

  try {
    // One activities-gated call replaces the old watchlist + watched pair,
    // and already de-duplicates by show.
    const { items } = await syncLibrary(
      tokens.access_token,
      `sync:${tokens.access_token}`
    );

    const taste: TasteShow[] = items.map((item) => ({
      title: item.show.title,
      year: item.show.year ?? null,
      genres: item.show.genres,
      rating: item.show.rating,
      status: item.show.status,
      watched: item.watched_episodes_count > 0,
    }));

    if (taste.length === 0) {
      return NextResponse.json({
        recommendations: [],
        cached: false,
        generatedAt: Date.now(),
        empty: true,
      });
    }

    const recs = await generateRecommendations(geminiKey, taste, 12);

    // Enrich each rec with Trakt show data (poster, ids, etc.)
    const excludedTitles = new Set(taste.map((t) => t.title.toLowerCase()));
    const enriched: RecommendationCard[] = await Promise.all(
      recs.map(async (rec) => {
        try {
          const res = await fetchSimkl(
            apiUrl("/search/tv", { q: rec.title, extended: "full", limit: 5 }),
            { headers: baseHeaders() }
          );
          if (!res.ok) return { ...rec, show: null };
          // Search returns a flat array using ids.simkl_id — normalise it and
          // re-wrap as { show } so the matching below is unchanged.
          const raw = await res.json();
          const results = (Array.isArray(raw) ? raw : [])
            .map(normalizeShow)
            .filter(Boolean)
            .map((show) => ({ show })) as Array<{ show: SimklShow }>;
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
