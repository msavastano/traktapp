import { NextResponse } from "next/server";
import { fetchSimkl, apiUrl, authHeaders } from "@/lib/simkl";
import { getSession } from "@/lib/session";
import { enrichAll, enrichListItem } from "@/lib/enrich";
import { syncLibrary } from "@/lib/sync";
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

/**
 * GET /api/watchlist
 *
 * Returns the authenticated user's TV library enriched with:
 *   - Per-show watch progress (aired vs completed)
 *   - Per-season breakdown
 *   - Next/upcoming episode info
 *   - Computed tracking status
 *
 * The watchlist and watched-history no longer need separate calls and manual
 * de-duplication: Simkl's /sync/all-items returns one row per show carrying
 * both the list status and the watch counts.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session.ok) return session.response;
  const { tokens } = session;

  const { searchParams } = new URL(req.url);
  const shouldStream = searchParams.get("stream") === "true";

  try {
    const cacheKey = watchlistKey(tokens.access_token);
    const cached = cacheGet<WatchlistPayload>(cacheKey);
    if (cached) {
      return NextResponse.json(cached, { headers: { "x-cache": "HIT" } });
    }

    // Goes through the activities gate: skips the library call entirely when
    // nothing changed, and uses date_from deltas otherwise.
    const { items } = await syncLibrary(
      tokens.access_token,
      `sync:${tokens.access_token}`
    );

    // Most recently added / watched first.
    items.sort((a, b) => {
      const aDate = a.last_watched_at ?? a.added_to_watchlist_at ?? "";
      const bDate = b.last_watched_at ?? b.added_to_watchlist_at ?? "";
      return bDate.localeCompare(aDate);
    });

    const paginationPayload = {
      page: "1",
      limit: null,
      pageCount: "1",
      itemCount: String(items.length),
    };

    if (shouldStream) {
      const encoder = new TextEncoder();
      let aborted = false;

      const readableStream = new ReadableStream({
        async start(controller) {
          // Send initial metadata packet so the grid can render immediately.
          const initialMetadata = {
            type: "metadata",
            shows: items.map((item) => ({
              listedAt: item.added_to_watchlist_at,
              show: item.show,
              trackingStatus:
                item.watched_episodes_count > 0 ? "behind" : "not_started",
              statusLabel:
                item.watched_episodes_count > 0
                  ? "Loading progress..."
                  : "Not started · Loading...",
              isEnriched: false,
            })),
            pagination: paginationPayload,
          };
          controller.enqueue(
            encoder.encode(JSON.stringify(initialMetadata) + "\n")
          );

          if (items.length === 0) {
            controller.close();
            return;
          }

          const queue = [...items];
          const enrichedShowsMap = new Map<number, TrackedShow>();

          const runWorker = async () => {
            while (queue.length > 0 && !aborted) {
              const item = queue.shift();
              if (!item) break;
              try {
                const enriched = await enrichListItem(item);
                if (aborted) break;

                enrichedShowsMap.set(item.show.ids.simkl, enriched);

                controller.enqueue(
                  encoder.encode(
                    JSON.stringify({
                      type: "enrich",
                      showId: item.show.ids.simkl,
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
                      showId: item.show.ids.simkl,
                      error: "Failed to enrich",
                    }) + "\n"
                  )
                );
              }
            }
          };

          const CONCURRENCY = 4;
          const workers = Array.from({ length: CONCURRENCY }, () => runWorker());
          await Promise.all(workers);

          if (!aborted) {
            const finalEnrichedShows = items
              .map((item) => enrichedShowsMap.get(item.show.ids.simkl))
              .filter(Boolean) as TrackedShow[];

            cacheSet(cacheKey, {
              shows: finalEnrichedShows,
              pagination: paginationPayload,
            });
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
          Connection: "keep-alive",
          "x-cache": "MISS",
        },
      });
    }

    const enriched = await enrichAll(items);

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
 * Adds a show to the user's plan-to-watch list.
 * Body: { showId: number } — Simkl show id.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session.ok) return session.response;
  const { tokens } = session;

  try {
    const { showId } = await req.json();
    if (!showId) {
      return NextResponse.json({ error: "showId is required" }, { status: 400 });
    }

    const res = await fetchSimkl(apiUrl("/sync/add-to-list"), {
      method: "POST",
      headers: authHeaders(tokens.access_token),
      // `to` is per-item: a top-level `to` is rejected with 400 empty_field.
      body: JSON.stringify({
        shows: [{ to: "plantowatch", ids: { simkl: showId } }],
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
