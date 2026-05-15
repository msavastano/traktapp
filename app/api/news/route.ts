import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  decodeTokens,
  isTokenExpired,
  refreshAccessToken,
  encodeTokens,
  COOKIE_NAME,
} from "@/lib/trakt";
import { generateShowNews, ShowNews } from "@/lib/gemini";

interface CacheEntry {
  generatedAt: number;
  result: ShowNews;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function cacheKey(title: string, year: number | null): string {
  return `${title.toLowerCase()}|${year ?? ""}`;
}

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
      return NextResponse.json({ error: "Auth expired" }, { status: 401 });
    }
  }

  const title = req.nextUrl.searchParams.get("title")?.trim();
  const yearParam = req.nextUrl.searchParams.get("year");
  const force = req.nextUrl.searchParams.get("refresh") === "1";

  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  const year = yearParam ? Number(yearParam) : null;
  const key = cacheKey(title, Number.isFinite(year) ? year : null);

  if (!force) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.generatedAt < CACHE_TTL_MS) {
      return NextResponse.json({
        ...cached.result,
        cached: true,
        generatedAt: cached.generatedAt,
      });
    }
  }

  try {
    const result = await generateShowNews(
      title,
      Number.isFinite(year) ? (year as number) : null
    );
    cache.set(key, { generatedAt: Date.now(), result });
    return NextResponse.json({
      ...result,
      cached: false,
      generatedAt: Date.now(),
    });
  } catch (error) {
    console.error("News fetch error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to fetch news", detail: message },
      { status: 500 }
    );
  }
}
