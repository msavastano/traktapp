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

const VALID_TYPES = ["trending", "anticipated"] as const;
type DiscoverType = (typeof VALID_TYPES)[number];

/**
 * GET /api/discover?type=trending|anticipated
 *
 * Returns Trakt's trending or anticipated shows.
 * Auth not required by Trakt, but we attach a bearer token when available.
 *
 * Response items: trending -> { watchers, show }, anticipated -> { list_count, show }
 */
export async function GET(req: NextRequest) {
  const typeParam = req.nextUrl.searchParams.get("type") ?? "trending";
  if (!VALID_TYPES.includes(typeParam as DiscoverType)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }
  const type = typeParam as DiscoverType;

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
    extended: "full,images",
    page: "1",
    limit: "40",
  });

  try {
    const res = await fetchTrakt(
      `${TRAKT_API_BASE}/shows/${type}?${params.toString()}`,
      { headers }
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
    return NextResponse.json({ shows: data });
  } catch (error) {
    console.error("Discover error:", error);
    return NextResponse.json(
      { error: "Discover fetch failed" },
      { status: 500 }
    );
  }
}
