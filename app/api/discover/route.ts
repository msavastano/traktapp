import { NextRequest, NextResponse } from "next/server";
import { fetchSimkl, apiUrl, baseHeaders, normalizeShow } from "@/lib/simkl";

const VALID_TYPES = ["trending", "anticipated"] as const;
type DiscoverType = (typeof VALID_TYPES)[number];

/**
 * Simkl has no single "anticipated" feed; upcoming premieres is the closest
 * equivalent to Trakt's most-listed-but-unreleased ranking.
 */
const ENDPOINTS: Record<DiscoverType, string> = {
  trending: "/tv/trending",
  anticipated: "/tv/premieres/soon",
};

/**
 * GET /api/discover?type=trending|anticipated
 *
 * Public endpoints — no token handling needed.
 *
 * Response items are `{ show }` entries, matching what the discover UI
 * consumes. Note these feeds return `ids.simkl_id` rather than `ids.simkl`,
 * which normalizeShow reconciles.
 */
export async function GET(req: NextRequest) {
  const typeParam = req.nextUrl.searchParams.get("type") ?? "trending";
  if (!VALID_TYPES.includes(typeParam as DiscoverType)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }
  const type = typeParam as DiscoverType;

  try {
    const res = await fetchSimkl(
      apiUrl(ENDPOINTS[type], { extended: "full", limit: 40 }),
      { headers: baseHeaders() }
    );

    if (!res.ok) {
      const text = await res.text();
      console.error(`Discover ${type} failed (${res.status}):`, text);
      return NextResponse.json(
        { error: "Discover fetch failed" },
        { status: res.status }
      );
    }

    const data = await res.json();
    const shows = (Array.isArray(data) ? data : [])
      .map(normalizeShow)
      .filter(Boolean)
      .map((show) => ({ show }));

    return NextResponse.json({ shows });
  } catch (error) {
    console.error("Discover error:", error);
    return NextResponse.json(
      { error: "Discover fetch failed" },
      { status: 500 }
    );
  }
}
