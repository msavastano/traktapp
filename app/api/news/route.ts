import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { generateShowNews, RateLimitError } from "@/lib/gemini";
import { GEMINI_KEY_HEADER, MISSING_KEY_ERROR } from "@/lib/gemini-key";
import { getCachedNews, setCachedNews, newsCacheKey } from "@/lib/news-cache";

export async function GET(req: NextRequest) {
  // Login is required to reach this, but no Simkl call is made here — the
  // session is only used as a gate on the user's own Gemini key.
  const session = await getSession();
  if (!session.ok) return session.response;

  const geminiKey = req.headers.get(GEMINI_KEY_HEADER)?.trim();
  if (!geminiKey) {
    return NextResponse.json(
      { error: MISSING_KEY_ERROR, detail: "Add your Gemini API key to fetch the latest news." },
      { status: 400 }
    );
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
      const headers: Record<string, string> = {};
      if (error.retryAfterMs > 0) headers["Retry-After"] = String(retryAfterSec);
      return NextResponse.json(
        {
          error: error.message,
          detail:
            error.scope === "per-day"
              ? "Daily quota — resets at midnight Pacific."
              : error.retryable
                ? `Retry in ~${retryAfterSec}s.`
                : "Web search grounding likely needs billing enabled on the key.",
          scope: error.scope,
          quotaId: error.quotaId,
          retryable: error.retryable,
          retryAfterMs: error.retryAfterMs,
        },
        { status: 429, headers }
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
