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

/**
 * GET /api/calendar
 *
 * Fetches the user's personalized TV show calendar.
 * Query Parameters:
 *   - start_date (string, YYYY-MM-DD): Date to start calendar (default: 3 days ago)
 *   - days (number): Number of days to fetch (default: 11 days)
 */
export async function GET(req: Request) {
  const auth = await getValidTokens();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { tokens } = auth;

  const { searchParams } = new URL(req.url);
  
  // Calculate defaults
  const today = new Date();
  const threeDaysAgo = new Date(today);
  threeDaysAgo.setDate(today.getDate() - 3);
  const defaultStartDate = threeDaysAgo.toISOString().split("T")[0];

  const startDate = searchParams.get("start_date") || defaultStartDate;
  const daysStr = searchParams.get("days") || "11";
  const days = parseInt(daysStr, 10) || 11;

  try {
    const headers = {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      "trakt-api-key": process.env.TRAKT_CLIENT_ID!,
      "trakt-api-version": "2",
      Authorization: `Bearer ${tokens.access_token}`,
    };

    const calendarUrl = `${TRAKT_API_BASE}/calendars/my/shows/${startDate}/${days}?extended=full`;
    const res = await fetchTrakt(calendarUrl, { headers });

    if (!res.ok) {
      const text = await res.text();
      console.error(`Calendar fetch failed (${res.status}):`, text);
      return NextResponse.json(
        { error: "Failed to fetch calendar from Trakt" },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Calendar fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch calendar" },
      { status: 500 }
    );
  }
}
