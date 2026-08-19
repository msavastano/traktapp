import { NextRequest, NextResponse } from "next/server";
import { fetchNewOnStreaming } from "@/lib/movies";
import { DEFAULT_REGION, STREAMING_SERVICES } from "@/lib/tmdb";
import type { StreamingRelease } from "@/lib/types";

interface StreamingPayload {
  releases: StreamingRelease[];
  /** key → label, so the client can render badges without duplicating the list. */
  services: Record<string, string>;
  generatedAt: string;
  region: string;
}

// 6h TTL — non-personalized data that changes rarely, matching the pattern
// used in lib/news-cache.ts for the same kind of global, slow-changing,
// expensive-to-compute data. Kept as a route-local module variable rather
// than lib/cache.ts's shared Map, since that cache is per-user (keyed by
// access token) with a small MAX_ENTRIES and FIFO-ish eviction — a single
// long-lived global entry there risks early eviction as user entries churn.
//
// The upstream data is refreshed at most daily anyway: TMDB receives one
// JustWatch export per day, so a shorter TTL would only add cost.
const TTL_MS = 6 * 60 * 60 * 1000;
let cached: { value: StreamingPayload; expiresAt: number } | null = null;

const SERVICE_LABELS: Record<string, string> = Object.fromEntries(
  STREAMING_SERVICES.map((s) => [s.key, s.label])
);

/**
 * GET /api/upcoming-streaming
 *
 * Global, non-personalized: movies currently watchable on a subscription tier
 * of one of the tracked services, newest release first. Rentals and purchases
 * are excluded. No auth required — nothing here is user-specific.
 *
 * Availability is region-specific; `?region=` takes an ISO 3166-1 alpha-2
 * code and defaults to US.
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("region") || DEFAULT_REGION;
  // TMDB rejects anything else, and this lands straight in an upstream URL.
  const region = /^[A-Za-z]{2}$/.test(raw) ? raw.toUpperCase() : DEFAULT_REGION;

  if (cached && cached.expiresAt > Date.now() && cached.value.region === region) {
    return NextResponse.json(cached.value, { headers: { "x-cache": "HIT" } });
  }

  try {
    const releases = await fetchNewOnStreaming(40, region);
    const payload: StreamingPayload = {
      releases,
      services: SERVICE_LABELS,
      generatedAt: new Date().toISOString(),
      region,
    };
    cached = { value: payload, expiresAt: Date.now() + TTL_MS };
    return NextResponse.json(payload, { headers: { "x-cache": "MISS" } });
  } catch (error) {
    console.error("New-on-streaming fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch streaming releases" },
      { status: 500 }
    );
  }
}
