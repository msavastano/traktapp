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
import { enrichWatchlist, enrichWatchlistItem } from "@/lib/enrich";
import { cacheGet, cacheSet, cacheDelete, watchlistKey } from "@/lib/cache";
import type { TrackedShow } from "@/lib/types";

interface WatchlistPayload {
  shows: TrackedShow[];
  pagination: {
    page: string | null;
    limit: string | null;
    pageCount: string | null;
    itemCount: string;
  };
}

const TRAKT_API_BASE = "https://api.trakt.tv";
const USER_AGENT = "TraktApp/1.0 (Next.js; +http://localhost:3000)";

/**
 * GET /api/watchlist
 *
 * Returns the authenticated user's TV show watchlist enriched with:
 *   - Per-show watch progress (aired vs completed)
 *   - Per-season breakdown
 *   - Next/upcoming episode info
 *   - Computed tracking status
 */
export async function GET(req: Request) {
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

  // Auto-refresh if expired
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
      return NextResponse.json({ user: null }, { status: 401 });
    }
  }

  const { searchParams } = new URL(req.url);
  const shouldStream = searchParams.get("stream") === "true";

  try {
    const cacheKey = watchlistKey(tokens.access_token);
    const cached = cacheGet<WatchlistPayload>(cacheKey);
    if (cached) {
      return NextResponse.json(cached, { headers: { "x-cache": "HIT" } });
    }

    const headers = {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      "trakt-api-key": process.env.TRAKT_CLIENT_ID!,
      "trakt-api-version": "2",
      Authorization: `Bearer ${tokens.access_token}`,
    };

    // Step 1: Fetch the raw watchlist AND watched shows with extended info
    const [watchlistRes, watchedRes] = await Promise.all([
      fetchTrakt(
        `${TRAKT_API_BASE}/users/me/watchlist/shows?page=1&limit=100&extended=full,images`,
        { headers }
      ),
      fetchTrakt(
        `${TRAKT_API_BASE}/sync/watched/shows?page=1&limit=100&extended=full,images`,
        { headers }
      )
    ]);

    if (!watchlistRes.ok) {
      const text = await watchlistRes.text();
      console.error(`Watchlist fetch failed (${watchlistRes.status}):`, text);
      return NextResponse.json(
        { error: "Failed to fetch watchlist" },
        { status: watchlistRes.status }
      );
    }
    
    if (!watchedRes.ok) {
      const text = await watchedRes.text();
      console.error(`Watched fetch failed (${watchedRes.status}):`, text);
      return NextResponse.json(
        { error: "Failed to fetch watched shows" },
        { status: watchedRes.status }
      );
    }

    const rawWatchlist = await watchlistRes.json();
    const rawWatched = await watchedRes.json();

    // Map watched items to the same structure as watchlist items
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mappedWatched = rawWatched.map((item: any) => ({
      listed_at: item.last_watched_at || item.last_updated_at || new Date().toISOString(),
      type: "show",
      show: item.show,
    }));

    // Combine them, deduplicating by Trakt ID
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const showMap = new Map<number, any>();
    
    for (const item of rawWatchlist) {
      if (item.show?.ids?.trakt) {
        showMap.set(item.show.ids.trakt, { ...item, fromWatchlist: true });
      }
    }
    
    for (const item of mappedWatched) {
      if (item.show?.ids?.trakt) {
        const existing = showMap.get(item.show.ids.trakt);
        showMap.set(item.show.ids.trakt, {
          ...item,
          fromWatchlist: existing ? existing.fromWatchlist : false,
          fromWatched: true,
        });
      }
    }

    const combinedList = Array.from(showMap.values());

    // Sort combined list by listed_at/last_watched_at descending
    combinedList.sort((a, b) => new Date(b.listed_at).getTime() - new Date(a.listed_at).getTime());

    const paginationPayload = {
      page: watchlistRes.headers.get("x-pagination-page"),
      limit: watchlistRes.headers.get("x-pagination-limit"),
      pageCount: watchlistRes.headers.get("x-pagination-page-count"),
      itemCount: String(combinedList.length),
    };

    if (shouldStream) {
      const encoder = new TextEncoder();
      let aborted = false;

      const readableStream = new ReadableStream({
        async start(controller) {
          // Send initial metadata packet
          const initialMetadata = {
            type: "metadata",
            shows: combinedList.map((item) => {
              const isWatched = item.fromWatched === true;
              return {
                listedAt: item.listed_at,
                show: item.show,
                trackingStatus: isWatched ? "behind" : "not_started",
                statusLabel: isWatched ? "Loading progress..." : "Not started · Loading...",
                isEnriched: false,
              };
            }),
            pagination: paginationPayload,
          };
          controller.enqueue(encoder.encode(JSON.stringify(initialMetadata) + "\n"));

          if (combinedList.length === 0) {
            controller.close();
            return;
          }

          const queue = [...combinedList];
          const enrichedShowsMap = new Map<number, TrackedShow>();

          const runWorker = async () => {
            while (queue.length > 0 && !aborted) {
              const item = queue.shift();
              if (!item) break;
              try {
                // Add a small throttle delay before processing to stagger requests
                await new Promise((resolve) => setTimeout(resolve, 100));
                if (aborted) break;

                const enriched = await enrichWatchlistItem(item, tokens.access_token);
                if (aborted) break;

                enrichedShowsMap.set(item.show.ids.trakt, enriched);

                controller.enqueue(
                  encoder.encode(
                    JSON.stringify({
                      type: "enrich",
                      showId: item.show.ids.trakt,
                      enriched,
                    }) + "\n"
                  )
                );
              } catch (err) {
                if (aborted) break;
                console.error(`Error enriching show ${item.show.title}:`, err);
                controller.enqueue(
                  encoder.encode(
                    JSON.stringify({
                      type: "error",
                      showId: item.show.ids.trakt,
                      error: "Failed to enrich",
                    }) + "\n"
                  )
                );
              }
            }
          };

          const CONCURRENCY = 2;
          const workers = Array.from({ length: CONCURRENCY }, () => runWorker());
          await Promise.all(workers);

          // Cache the full result if all completed without abort
          if (!aborted) {
            const finalEnrichedShows = combinedList
              .map((item) => enrichedShowsMap.get(item.show.ids.trakt))
              .filter(Boolean) as TrackedShow[];

            const payload: WatchlistPayload = {
              shows: finalEnrichedShows,
              pagination: paginationPayload,
            };
            cacheSet(cacheKey, payload);
          }

          controller.close();
        },
        cancel() {
          aborted = true;
        },
      });

      return new Response(readableStream, {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          "x-cache": "MISS",
        },
      });
    }

    // Step 2: Enrich each show with progress + tracking status (standard JSON flow)
    const enriched = await enrichWatchlist(combinedList, tokens.access_token);

    const payload: WatchlistPayload = {
      shows: enriched,
      pagination: paginationPayload,
    };
    cacheSet(cacheKey, payload);

    return NextResponse.json(payload, { headers: { "x-cache": "MISS" } });
  } catch (error) {
    console.error("Watchlist fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch watchlist" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/watchlist
 *
 * Adds a show to the user's Trakt watchlist.
 * Body: { showId: number } — Trakt show id.
 */
export async function POST(req: Request) {
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
      return NextResponse.json({ user: null }, { status: 401 });
    }
  }

  try {
    const { showId } = await req.json();
    if (!showId) {
      return NextResponse.json({ error: "showId is required" }, { status: 400 });
    }

    const res = await fetchTrakt(`${TRAKT_API_BASE}/sync/watchlist`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        "trakt-api-key": process.env.TRAKT_CLIENT_ID!,
        "trakt-api-version": "2",
        Authorization: `Bearer ${tokens.access_token}`,
      },
      body: JSON.stringify({
        shows: [{ ids: { trakt: showId } }],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`Add to watchlist failed (${res.status}):`, text);
      return NextResponse.json(
        { error: "Failed to add to watchlist" },
        { status: res.status }
      );
    }

    const data = await res.json();
    cacheDelete(watchlistKey(tokens.access_token));
    return NextResponse.json(data);
  } catch (error) {
    console.error("Add to watchlist error:", error);
    return NextResponse.json(
      { error: "Failed to add to watchlist" },
      { status: 500 }
    );
  }
}
