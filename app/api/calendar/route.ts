import { NextResponse } from "next/server";
import { fetchSimkl, cdnUrl, baseHeaders } from "@/lib/simkl";
import { getSession } from "@/lib/session";
import { syncLibrary } from "@/lib/sync";
import { cacheGet, cacheSet } from "@/lib/cache";

/**
 * GET /api/calendar
 *
 * Returns the user's personalised upcoming-episode calendar.
 *
 * Simkl has no equivalent of Trakt's `/calendars/my/shows` — its calendar is a
 * single global CDN feed. So the personalisation happens here: fetch the
 * global feed once (cached, since every user shares it), then filter it down
 * to the shows in this user's synced library.
 *
 * The feed is a join: `calendar[]` entries carry `simkl_id` + episode, and
 * `metadata{}` is keyed by that same id with the show record.
 *
 * Query params:
 *   - start_date (YYYY-MM-DD): defaults to 3 days ago
 *   - days (number): defaults to 11
 */

interface CalendarFeedEntry {
  simkl_id: number;
  date: string;
  finale_type: string | null;
  episode: { season: number; episode: number; title: string; url?: string };
}

interface CalendarFeedMeta {
  title: string;
  poster?: string;
  ids?: { simkl_id?: number; slug?: string };
  release_date?: string;
}

interface CalendarFeed {
  calendar: CalendarFeedEntry[];
  metadata: Record<string, CalendarFeedMeta>;
}

/** The global feed is identical for every user, so cache it app-wide. */
const FEED_TTL_MS = 60 * 60 * 1000; // 1 hour

async function fetchFeed(type: "tv" | "anime"): Promise<CalendarFeed | null> {
  const key = `calendar-feed:${type}`;
  const cached = cacheGet<CalendarFeed>(key);
  if (cached) return cached;

  try {
    const res = await fetchSimkl(cdnUrl(`/calendar/v2/${type}.json`), {
      headers: baseHeaders(),
    });
    if (!res.ok) {
      console.warn(`calendar feed ${type} -> ${res.status}`);
      return null;
    }
    const feed = await res.json();
    cacheSet(key, feed, FEED_TTL_MS);
    return feed;
  } catch (err) {
    console.warn(`calendar feed ${type} threw:`, err);
    return null;
  }
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session.ok) return session.response;
  const { tokens } = session;

  const { searchParams } = new URL(req.url);

  const today = new Date();
  const threeDaysAgo = new Date(today);
  threeDaysAgo.setDate(today.getDate() - 3);
  const defaultStartDate = threeDaysAgo.toISOString().split("T")[0];

  const startDate = searchParams.get("start_date") || defaultStartDate;
  const days = parseInt(searchParams.get("days") || "11", 10) || 11;

  const rangeStart = new Date(`${startDate}T00:00:00Z`);
  const rangeEnd = new Date(rangeStart);
  rangeEnd.setDate(rangeStart.getDate() + days);

  try {
    // Goes through the activities gate, so this is usually free.
    const { items } = await syncLibrary(
      tokens.access_token,
      `sync:${tokens.access_token}`
    );
    const libraryIds = new Set(items.map((i) => i.show.ids.simkl));

    const [tv, anime] = await Promise.all([fetchFeed("tv"), fetchFeed("anime")]);

    const results = [];
    for (const feed of [tv, anime]) {
      if (!feed?.calendar) continue;
      for (const entry of feed.calendar) {
        if (!libraryIds.has(entry.simkl_id)) continue;

        const when = new Date(entry.date);
        if (when < rangeStart || when >= rangeEnd) continue;

        const meta = feed.metadata?.[String(entry.simkl_id)];

        results.push({
          first_aired: entry.date,
          episode: {
            season: entry.episode.season,
            number: entry.episode.episode,
            title: entry.episode.title,
            // The feed carries no episode id, so synthesise the same stable
            // key shape lib/enrich.ts uses. Display/React-key only.
            ids: {
              simkl:
                entry.simkl_id * 100_000 +
                entry.episode.season * 1_000 +
                entry.episode.episode,
            },
          },
          show: {
            title: meta?.title ?? "",
            year: meta?.release_date
              ? new Date(meta.release_date).getUTCFullYear()
              : null,
            ids: {
              simkl: entry.simkl_id,
              slug: meta?.ids?.slug ?? "",
            },
          },
        });
      }
    }

    results.sort((a, b) => a.first_aired.localeCompare(b.first_aired));

    return NextResponse.json(results);
  } catch (error) {
    console.error("Calendar fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch calendar" },
      { status: 500 }
    );
  }
}
