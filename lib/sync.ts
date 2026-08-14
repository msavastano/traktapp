/**
 * Simkl two-phase sync.
 *
 * Simkl's API rules are strict about this and enforce them by suspending
 * client_ids, so the flow here is deliberate:
 *
 *   PHASE 1 (once per user, no local state yet)
 *     Fetch each library separately and SEQUENTIALLY, without date_from.
 *     Parallel calls spike their CPU on large libraries.
 *
 *   PHASE 2 (every subsequent sync)
 *     1. GET /sync/activities  — cheap timestamp check
 *     2. If the timestamp matches what we stored, STOP. No further calls.
 *     3. Otherwise GET /sync/all-items?date_from=<saved timestamp> and merge
 *        the delta into the stored library.
 *
 * Rules this implements, from the developer dashboard:
 *   - Never call the library endpoints without first checking /sync/activities
 *   - Always pass date_from once initialised
 *   - Never poll unconditionally; sync only on user interaction
 *   - Send the activities timestamp back verbatim, never reformatted
 */

import type { SimklListItem, SimklAllItemsResponse } from "./types";
import { fetchSimkl, apiUrl, authHeaders } from "./simkl";
import { getSyncState, setSyncState, type SyncState } from "./sync-store";

export interface SimklActivities {
  all: string;
  settings?: { all?: string };
  tv_shows?: { all?: string };
  anime?: { all?: string };
  movies?: { all?: string };
}

/**
 * The app renders TV and anime only, so it gates on those two timestamps
 * rather than the top-level `all` — a movies-only change costs us nothing.
 */
function watchedStamp(activities: SimklActivities): string {
  return [
    activities.tv_shows?.all ?? "",
    activities.anime?.all ?? "",
  ].join("|");
}

async function fetchActivities(
  accessToken: string
): Promise<SimklActivities> {
  const res = await fetchSimkl(apiUrl("/sync/activities"), {
    headers: authHeaders(accessToken),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch activities (${res.status})`);
  }
  return res.json();
}

/** One library bucket, no date_from. Used only for the initial pull. */
async function fetchLibrary(
  accessToken: string,
  type: "shows" | "anime"
): Promise<SimklListItem[]> {
  const res = await fetchSimkl(
    apiUrl(`/sync/all-items/${type}/all`, {
      extended: "full",
      next_watch_info: "yes",
      episode_watched_at: "yes",
    }),
    { headers: authHeaders(accessToken), cache: "no-store" }
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch ${type} library (${res.status})`);
  }
  const data: SimklAllItemsResponse = await res.json();
  return [...(data.shows ?? []), ...(data.anime ?? [])];
}

/** Everything changed since `dateFrom`, across all types, in one request. */
async function fetchDelta(
  accessToken: string,
  dateFrom: string
): Promise<SimklListItem[]> {
  const res = await fetchSimkl(
    apiUrl("/sync/all-items", {
      // Sent exactly as /sync/activities returned it — never reformatted.
      date_from: dateFrom,
      extended: "full",
      next_watch_info: "yes",
      episode_watched_at: "yes",
    }),
    { headers: authHeaders(accessToken), cache: "no-store" }
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch delta (${res.status})`);
  }
  const data: SimklAllItemsResponse = await res.json();
  return [...(data.shows ?? []), ...(data.anime ?? [])];
}

/**
 * Merges a delta over the stored library, keyed by Simkl id. Delta rows
 * replace stored rows wholesale; unchanged rows are left untouched.
 */
function mergeDelta(
  existing: SimklListItem[],
  delta: SimklListItem[]
): SimklListItem[] {
  const byId = new Map<number, SimklListItem>();
  for (const item of existing) byId.set(item.show.ids.simkl, item);
  for (const item of delta) byId.set(item.show.ids.simkl, item);
  return [...byId.values()];
}

export interface SyncResult {
  items: SimklListItem[];
  /** True when the activities gate matched and no library call was made. */
  unchanged: boolean;
  phase: "cached" | "initial" | "delta";
}

/**
 * Returns the user's library, doing the least work Simkl's rules allow.
 *
 * `userKey` scopes stored state to one user — pass a stable per-user value,
 * not the raw access token if you can avoid it.
 */
export async function syncLibrary(
  accessToken: string,
  userKey: string
): Promise<SyncResult> {
  const activities = await fetchActivities(accessToken);
  const stamp = watchedStamp(activities);
  const state: SyncState | null = await getSyncState(userKey);

  // Nothing moved since last time — the cheap path, and the common one.
  if (state && state.stamp === stamp) {
    return { items: state.items, unchanged: true, phase: "cached" };
  }

  // PHASE 1 — no local state, so pull each library separately and in
  // sequence. Deliberately not Promise.all: parallel initial pulls are what
  // the API rules single out as harmful.
  if (!state) {
    const shows = await fetchLibrary(accessToken, "shows");
    const anime = await fetchLibrary(accessToken, "anime");
    const items = mergeDelta(shows, anime);
    await setSyncState(userKey, { stamp, lastSyncedAt: activities.all, items });
    return { items, unchanged: false, phase: "initial" };
  }

  // PHASE 2 — delta only.
  const delta = await fetchDelta(accessToken, state.lastSyncedAt);
  const items = mergeDelta(state.items, delta);
  await setSyncState(userKey, { stamp, lastSyncedAt: activities.all, items });
  return { items, unchanged: false, phase: "delta" };
}
