import { NextRequest, NextResponse } from "next/server";
import { fetchCandidateMoviePool, fetchUpcomingStreamingReleases } from "@/lib/movies";
import type { UpcomingStreamingRelease } from "@/lib/types";

interface UpcomingStreamingPayload {
  releases: UpcomingStreamingRelease[];
  generatedAt: string;
  country: string;
}

// 6h TTL — non-personalized data that changes rarely, matching the pattern
// used in lib/news-cache.ts for the same kind of global, slow-changing,
// expensive-to-compute data. Kept as a route-local module variable rather
// than lib/cache.ts's shared Map, since that cache is per-user (keyed by
// access token) with a small MAX_ENTRIES and FIFO-ish eviction — a single
// long-lived global entry there risks early eviction as user entries churn.
const TTL_MS = 6 * 60 * 60 * 1000;
let cached: { value: UpcomingStreamingPayload; expiresAt: number } | null = null;

/**
 * GET /api/upcoming-streaming
 *
 * Global, non-personalized: movies from Trakt's trending+popular pool that
 * have an upcoming digital/tv release with a service name in `note` (best
 * effort — see lib/movies.ts). No auth required — the underlying Trakt
 * endpoints are public and the result isn't user-specific.
 */
export async function GET(req: NextRequest) {
  const country = req.nextUrl.searchParams.get("country") || "us";

  if (cached && cached.expiresAt > Date.now() && cached.value.country === country) {
    return NextResponse.json(cached.value, { headers: { "x-cache": "HIT" } });
  }

  try {
    const pool = await fetchCandidateMoviePool();
    const releases = await fetchUpcomingStreamingReleases(pool);
    const payload: UpcomingStreamingPayload = {
      releases,
      generatedAt: new Date().toISOString(),
      country,
    };
    cached = { value: payload, expiresAt: Date.now() + TTL_MS };
    return NextResponse.json(payload, { headers: { "x-cache": "MISS" } });
  } catch (error) {
    console.error("Upcoming streaming fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch upcoming streaming releases" },
      { status: 500 }
    );
  }
}
