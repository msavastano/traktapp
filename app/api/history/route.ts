import { NextResponse } from "next/server";
import { fetchSimkl, apiUrl, authHeaders } from "@/lib/simkl";
import { getSession } from "@/lib/session";
import { cacheDelete, watchlistKey } from "@/lib/cache";

interface HistoryBody {
  showId?: number;
  season?: number;
  episode?: number;
}

/**
 * Simkl addresses episodes by (show, season, episode) rather than by an
 * episode id, so all three shapes hang off the show's ids.
 */
function buildPayload(body: HistoryBody) {
  const { showId, season, episode } = body;
  if (!showId) return null;

  const ids = { simkl: showId };

  // One episode
  if (typeof season === "number" && typeof episode === "number") {
    return {
      shows: [{ ids, seasons: [{ number: season, episodes: [{ number: episode }] }] }],
    };
  }

  // A whole season — omitting `episodes` marks every episode in it
  if (typeof season === "number") {
    return { shows: [{ ids, seasons: [{ number: season }] }] };
  }

  // The whole show
  return { shows: [{ ids }] };
}

/**
 * POST /api/history — marks watched.
 * DELETE /api/history — removes from history (unwatch).
 *
 * Body shapes (both methods):
 *   { showId, season, episode }  — one episode
 *   { showId, season }           — entire season of a show
 *   { showId }                   — entire show (every aired episode)
 */
export async function POST(req: Request) {
  return handleHistory(req, "add");
}

export async function DELETE(req: Request) {
  return handleHistory(req, "remove");
}

async function handleHistory(req: Request, action: "add" | "remove") {
  const session = await getSession();
  if (!session.ok) return session.response;
  const { tokens } = session;

  try {
    const body = (await req.json()) as HistoryBody;
    const payload = buildPayload(body);
    if (!payload) {
      // Logged because a silently-rejected body is otherwise invisible in the
      // server log and surfaces only as a generic client-side failure.
      console.error(
        `Sync history ${action}: rejected body, showId missing:`,
        JSON.stringify(body)
      );
      return NextResponse.json({ error: "showId is required" }, { status: 400 });
    }

    const path =
      action === "add" ? "/sync/history" : "/sync/history/remove";

    const res = await fetchSimkl(apiUrl(path), {
      method: "POST",
      headers: authHeaders(tokens.access_token),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`Sync history ${action} failed (${res.status}):`, text);
      return NextResponse.json(
        {
          error:
            action === "add" ? "Failed to mark as watched" : "Failed to unwatch",
        },
        { status: res.status }
      );
    }

    const data = await res.json();
    cacheDelete(watchlistKey(tokens.access_token));
    return NextResponse.json(data);
  } catch (error) {
    console.error(`Sync history ${action} error:`, error);
    return NextResponse.json(
      {
        error:
          action === "add" ? "Failed to mark as watched" : "Failed to unwatch",
      },
      { status: 500 }
    );
  }
}
