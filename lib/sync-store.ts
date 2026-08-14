/**
 * Persistence for Simkl sync state, backed by Redis.
 *
 * Why this has to be durable: Simkl's rules require that after the initial
 * pull, every subsequent sync passes `date_from`. That only holds if the
 * last-sync timestamp survives between requests. A process-local store dies on
 * every Vercel cold start, so each cold request would look like a brand-new
 * user and trigger a full Phase 1 pull — precisely the pattern that gets a
 * client_id suspended.
 *
 * Connection reuse: the client is a module-level singleton created lazily on
 * first use. Vercel's Fluid Compute reuses function instances across
 * invocations, so in practice one connection serves many requests.
 *
 * Degradation: if Redis is unreachable, reads and writes fall back to an
 * in-process Map rather than throwing. That keeps the app serving, and a warm
 * instance still avoids repeating Phase 1 on every request — but it is a
 * degraded mode, so it logs loudly.
 */

import { createHash } from "node:crypto";
import { createClient, type RedisClientType } from "redis";
import type { SimklListItem } from "./types";

export interface SyncState {
  /** Composite of the tv_shows/anime activity timestamps we gate on. */
  stamp: string;
  /** The `activities.all` value, sent back verbatim as `date_from`. */
  lastSyncedAt: string;
  items: SimklListItem[];
}

/**
 * Sync state is a rebuildable cache, so it expires rather than accumulating
 * forever for users who never return. Expiry is safe: a miss simply falls back
 * to Phase 1, which is the documented behaviour when no timestamp is stored.
 */
const TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

const KEY_PREFIX = "simkl:sync:";

/** In-process fallback used only when Redis is unavailable. */
const fallback = new Map<string, SyncState>();

let client: RedisClientType | null = null;
let connecting: Promise<RedisClientType | null> | null = null;

/**
 * Resolves a connected client, or null when Redis is unavailable.
 *
 * Never throws — callers degrade to the in-process map instead of failing the
 * request.
 */
async function getClient(): Promise<RedisClientType | null> {
  if (client?.isOpen) return client;
  if (connecting) return connecting;

  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn(
      "[sync-store] REDIS_URL is not set — falling back to in-process state. " +
        "This is unsafe in production: cold starts will force full Phase 1 pulls."
    );
    return null;
  }

  connecting = (async () => {
    try {
      const c: RedisClientType = createClient({ url });
      // Without a listener, a connection error is an unhandled 'error' event
      // and takes the process down.
      c.on("error", (err) => {
        console.error("[sync-store] Redis client error:", err);
      });
      await c.connect();
      client = c;
      return c;
    } catch (err) {
      console.error(
        "[sync-store] Redis connect failed, using in-process fallback:",
        err
      );
      client = null;
      return null;
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}

/**
 * Hashes the caller's key so raw access tokens never appear in Redis keys or
 * in anything that might log them.
 */
function redisKey(userKey: string): string {
  const digest = createHash("sha256").update(userKey).digest("hex");
  return `${KEY_PREFIX}${digest}`;
}

export async function getSyncState(
  userKey: string
): Promise<SyncState | null> {
  const c = await getClient();
  if (!c) return fallback.get(userKey) ?? null;

  try {
    const raw = await c.get(redisKey(userKey));
    if (!raw) return null;
    return JSON.parse(raw) as SyncState;
  } catch (err) {
    console.error("[sync-store] read failed, using fallback:", err);
    return fallback.get(userKey) ?? null;
  }
}

export async function setSyncState(
  userKey: string,
  state: SyncState
): Promise<void> {
  // Always keep the in-process copy current so a later Redis outage degrades
  // to something useful rather than to nothing.
  fallback.set(userKey, state);

  const c = await getClient();
  if (!c) return;

  try {
    await c.set(redisKey(userKey), JSON.stringify(state), { EX: TTL_SECONDS });
  } catch (err) {
    console.error("[sync-store] write failed, kept in-process only:", err);
  }
}

export async function clearSyncState(userKey: string): Promise<void> {
  fallback.delete(userKey);

  const c = await getClient();
  if (!c) return;

  try {
    await c.del(redisKey(userKey));
  } catch (err) {
    console.error("[sync-store] delete failed:", err);
  }
}
