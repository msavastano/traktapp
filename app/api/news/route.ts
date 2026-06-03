import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  decodeTokens,
  isTokenExpired,
  refreshAccessToken,
  encodeTokens,
  COOKIE_NAME,
} from "@/lib/trakt";
import { generateShowNews, RateLimitError } from "@/lib/gemini";
import { GEMINI_KEY_HEADER, MISSING_KEY_ERROR } from "@/lib/gemini-key";
import { getCachedNews, setCachedNews, newsCacheKey } from "@/lib/news-cache";

export async function GET(req: NextRequest) {
  const cookieStore = await cookies();
  const encoded = cookieStore.get(COOKIE_NAME)?.value;
  if (!encoded) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const geminiKey = req.headers.get(GEMINI_KEY_HEADER)?.trim();
  if (!geminiKey) {
    return NextResponse.json(
      { error: MISSING_KEY_ERROR, detail: "Add your Gemini API key to fetch the latest news." },
      { status: 400 }
    );
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
  const normalizedYear = Number.isFinite(year) ? (year as number) : null;
  const key = newsCacheKey(title, normalizedYear);

  if (!force) {
    const cached = await getCachedNews(key);
    if (cached) {
      return NextResponse.json({
        ...cached.result,
        cached: true,
        generatedAt: cached.generatedAt,
      });
    }
  }

  try {
    const result = await generateShowNews(geminiKey, title, normalizedYear);
    await setCachedNews(key, { generatedAt: Date.now(), result });
    return NextResponse.json({
      ...result,
      cached: false,
      generatedAt: Date.now(),
    });
  } catch (error) {
    if (error instanceof RateLimitError) {
      const retryAfterSec = Math.ceil(error.retryAfterMs / 1000);
      return NextResponse.json(
        {
          error: error.message,
          detail: `Free-tier Gemini search quota hit. Retry in ~${retryAfterSec}s.`,
          retryAfterMs: error.retryAfterMs,
        },
        { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
      );
    }
    console.error("News fetch error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to fetch news", detail: message },
      { status: 500 }
    );
  }
}
