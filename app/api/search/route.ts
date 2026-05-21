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

const TRAKT_API_BASE = "https://api.trakt.tv";
const USER_AGENT = "TraktApp/1.0 (Next.js; +http://localhost:3000)";

/**
 * GET /api/search?q=...
 *
 * Searches Trakt for TV shows by text query.
 * Auth not strictly required by Trakt, but we still attach a bearer
 * token when available so the response includes user-personalized fields.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ results: [] });
  }

  const cookieStore = await cookies();
  const encoded = cookieStore.get(COOKIE_NAME)?.value;

  let accessToken: string | null = null;
  if (encoded) {
    let tokens = decodeTokens(encoded);
    if (tokens) {
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
          // fall through unauthenticated
        }
      }
      accessToken = tokens?.access_token ?? null;
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    "trakt-api-key": process.env.TRAKT_CLIENT_ID!,
    "trakt-api-version": "2",
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const params = new URLSearchParams({
    query: q,
    extended: "full",
    limit: "20",
  });

  try {
    const res = await fetchTrakt(
      `${TRAKT_API_BASE}/search/show?${params.toString()}`,
      { headers }
    );
    if (!res.ok) {
      const text = await res.text();
      console.error(`Search failed (${res.status}):`, text);
      return NextResponse.json(
        { error: "Search failed" },
        { status: res.status }
      );
    }
    const data = await res.json();
    return NextResponse.json({ results: data });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
