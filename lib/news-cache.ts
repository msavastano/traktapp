import { ShowNews } from "@/lib/gemini";

// Durable cache for generated show news. Backed by Upstash Redis (REST) when
// UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set; otherwise falls
// back to a process-local Map (fine for local dev, lost on serverless cold
// starts). Keeping news cached across cold starts is what stops every restart
// from re-spending the free-tier Gemini search quota.

export interface CachedNews {
  generatedAt: number;
  result: ShowNews;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const KEY_PREFIX = "news:v1:";

const REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const useRedis = Boolean(REST_URL && REST_TOKEN);

// Fallback store for when Redis isn't configured.
const memory = new Map<string, CachedNews>();

export function newsCacheKey(title: string, year: number | null): string {
  return `${title.toLowerCase()}|${year ?? ""}`;
}

async function redisCommand(command: (string | number)[]): Promise<unknown> {
  // POST the command as a JSON array so large/odd values (multi-KB news
  // payloads) aren't crammed into the URL path.
  const res = await fetch(REST_URL as string, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Upstash error ${res.status}`);
  }
  const json = (await res.json()) as { result?: unknown };
  return json.result;
}

export async function getCachedNews(key: string): Promise<CachedNews | null> {
  if (!useRedis) {
    const entry = memory.get(key);
    if (entry && Date.now() - entry.generatedAt < CACHE_TTL_MS) return entry;
    if (entry) memory.delete(key);
    return null;
  }
  try {
    const raw = await redisCommand(["GET", KEY_PREFIX + key]);
    if (typeof raw !== "string") return null;
    return JSON.parse(raw) as CachedNews;
  } catch (error) {
    console.error("News cache read failed:", error);
    return null;
  }
}

export async function setCachedNews(
  key: string,
  entry: CachedNews
): Promise<void> {
  if (!useRedis) {
    memory.set(key, entry);
    return;
  }
  try {
    // SET key value EX <ttl-seconds>
    await redisCommand([
      "SET",
      KEY_PREFIX + key,
      JSON.stringify(entry),
      "EX",
      Math.floor(CACHE_TTL_MS / 1000),
    ]);
  } catch (error) {
    console.error("News cache write failed:", error);
  }
}
