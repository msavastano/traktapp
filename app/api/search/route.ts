import { NextRequest, NextResponse } from "next/server";
import { fetchSimkl, apiUrl, baseHeaders, normalizeShow } from "@/lib/simkl";

/**
 * GET /api/search?q=...
 *
 * Searches Simkl for TV shows by text query.
 *
 * Public endpoint — client_id is the only requirement, so unlike the Trakt
 * version there is no token handling here at all.
 *
 * Simkl returns a flat array of shows; the response is re-wrapped as
 * `{ show }` entries to keep the shape the search UI already consumes.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ results: [] });
  }

  try {
    const res = await fetchSimkl(
      apiUrl("/search/tv", { q, extended: "full", limit: 20 }),
      { headers: baseHeaders() }
    );

    if (!res.ok) {
      const text = await res.text();
      console.error(`Search failed (${res.status}):`, text);
      return NextResponse.json({ error: "Search failed" }, { status: res.status });
    }

    const data = await res.json();
    const results = (Array.isArray(data) ? data : [])
      .map(normalizeShow)
      .filter(Boolean)
      .map((show) => ({ show }));

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
