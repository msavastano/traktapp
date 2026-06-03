import { GoogleGenAI, Type } from "@google/genai";

const MODEL = "gemini-3.1-flash-lite";

// Raised when Gemini returns 429 RESOURCE_EXHAUSTED. Carries the retry delay
// (ms) parsed from the API's RetryInfo so callers can surface it to the user.
export class RateLimitError extends Error {
  retryAfterMs: number;
  // "per-minute" → short retry makes sense; "per-day" → quota exhausted until
  // reset (retrying soon is pointless); "unknown" → no quota dimension found.
  scope: "per-minute" | "per-day" | "unknown";
  quotaId?: string;
  retryable: boolean;
  constructor(
    message: string,
    opts: {
      retryAfterMs: number;
      scope: "per-minute" | "per-day" | "unknown";
      quotaId?: string;
      retryable: boolean;
    }
  ) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterMs = opts.retryAfterMs;
    this.scope = opts.scope;
    this.quotaId = opts.quotaId;
    this.retryable = opts.retryable;
  }
}

function asRateLimit(error: unknown): RateLimitError | null {
  const status = (error as { status?: number })?.status;
  const message = error instanceof Error ? error.message : String(error);
  const is429 =
    status === 429 ||
    /\b429\b/.test(message) ||
    /RESOURCE_EXHAUSTED/i.test(message);
  if (!is429) return null;

  // Log the full body once so the real quota dimension is visible in server
  // logs (per-minute vs per-day vs grounding-not-allowed).
  console.error("Gemini 429 body:", message);

  // Google's RetryInfo, e.g. {"retryDelay":"34s"}. Absent for daily caps.
  const delayMatch = message.match(/"?retryDelay"?\s*:\s*"?(\d+(?:\.\d+)?)s/i);
  const retryDelayMs = delayMatch ? Math.ceil(Number(delayMatch[1]) * 1000) : null;

  // QuotaFailure violations carry a quotaId like
  // "GenerateRequestsPerMinutePerProjectPerModel" or "...PerDay...".
  const quotaMatch = message.match(/"?quotaId"?\s*:\s*"?([A-Za-z0-9_]+)/);
  const quotaId = quotaMatch?.[1];
  const isPerDay = /PerDay/i.test(message) || /PerDay/i.test(quotaId ?? "");
  const isPerMinute = /PerMinute/i.test(message) || /PerMinute/i.test(quotaId ?? "");

  const scope: RateLimitError["scope"] = isPerDay
    ? "per-day"
    : isPerMinute
      ? "per-minute"
      : "unknown";

  // Only worth auto-retrying soon when it's a per-minute limit with a short,
  // server-supplied delay. Daily caps reset hours away; "unknown" with no
  // delay (e.g. grounding disabled on free tier) shouldn't fake a 30s retry.
  const retryable =
    scope === "per-minute" && retryDelayMs !== null && retryDelayMs <= 120_000;

  const userMessage = isPerDay
    ? "Gemini daily free-tier quota for web search is used up. It resets at midnight Pacific — or add billing for a higher limit."
    : scope === "per-minute"
      ? "Gemini per-minute rate limit hit. Try again in a moment."
      : "Gemini rejected the web-search request (free-tier quota). Web search grounding may require enabling billing on your Google AI Studio key.";

  return new RateLimitError(userMessage, {
    retryAfterMs: retryDelayMs ?? 0,
    scope,
    quotaId,
    retryable,
  });
}

// Google Search grounding has a much stricter free-tier quota than plain
// generation. Serialize grounded calls and space them out so a flurry of
// modal opens doesn't trip the per-minute limit. Process-local (per server
// instance); on serverless this resets per cold start.
const GROUNDED_MIN_INTERVAL_MS = 1_500;
let groundedChain: Promise<unknown> = Promise.resolve();
let lastGroundedAt = 0;

function runGrounded<T>(fn: () => Promise<T>): Promise<T> {
  const run = groundedChain.then(async () => {
    const wait = GROUNDED_MIN_INTERVAL_MS - (Date.now() - lastGroundedAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      lastGroundedAt = Date.now();
    }
  });
  // Keep the chain alive even if this call rejects.
  groundedChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

// Bring-your-own-key: callers pass the end user's Gemini API key (entered in the
// browser and forwarded per request). A new client is created per key so keys
// are never shared or cached across users.
function getClient(apiKey: string): GoogleGenAI {
  if (!apiKey) {
    throw new Error("A Gemini API key is required");
  }
  return new GoogleGenAI({ apiKey });
}

export interface TasteShow {
  title: string;
  year: number | null;
  genres?: string[];
  rating?: number;
  status?: string;
  watched: boolean;
}

export interface GeminiRecommendation {
  title: string;
  year: number;
  reason: string;
  genres: string[];
}

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    recommendations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          year: { type: Type.INTEGER },
          reason: { type: Type.STRING },
          genres: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["title", "year", "reason", "genres"],
        propertyOrdering: ["title", "year", "reason", "genres"],
      },
    },
  },
  required: ["recommendations"],
};

function buildPrompt(taste: TasteShow[], count: number): string {
  const watched = taste
    .filter((s) => s.watched)
    .map((s) => `- ${s.title}${s.year ? ` (${s.year})` : ""}${s.genres?.length ? ` [${s.genres.join(", ")}]` : ""}`)
    .join("\n");
  const watchlist = taste
    .filter((s) => !s.watched)
    .map((s) => `- ${s.title}${s.year ? ` (${s.year})` : ""}${s.genres?.length ? ` [${s.genres.join(", ")}]` : ""}`)
    .join("\n");

  const exclusions = taste.map((s) => s.title).join(" | ");

  return `You are a TV show recommendation engine. Based on the user's taste profile below, suggest ${count} TV shows they would likely enjoy.

WATCHED (shows they've already seen):
${watched || "(none)"}

WATCHLIST (shows they plan to watch):
${watchlist || "(none)"}

Rules:
- Do NOT recommend any show from the lists above. Excluded titles: ${exclusions || "(none)"}
- Only real, existing TV series. No movies, miniseries OK.
- Prefer shows with strong critical reception or a passionate audience.
- Diversify across genres represented in the user's profile, but lean toward their dominant tastes.
- For each rec, give a concise 1-2 sentence reason that references specific shows the user has watched.
- Use the show's original release year (first air year).`;
}

export async function generateRecommendations(
  apiKey: string,
  taste: TasteShow[],
  count: number = 12
): Promise<GeminiRecommendation[]> {
  const ai = getClient(apiKey);
  let response;
  try {
    response = await ai.models.generateContent({
      model: MODEL,
      contents: buildPrompt(taste, count),
      config: {
        responseMimeType: "application/json",
        responseSchema,
        temperature: 0.8,
      },
    });
  } catch (error) {
    throw asRateLimit(error) ?? error;
  }

  const text = response.text;
  if (!text) {
    throw new Error("Gemini returned empty response");
  }

  const parsed = JSON.parse(text) as { recommendations: GeminiRecommendation[] };
  return parsed.recommendations ?? [];
}

export interface NewsSource {
  uri: string;
  title: string;
}

export interface ShowNews {
  summary: string;
  sources: NewsSource[];
}

export async function generateShowNews(
  apiKey: string,
  title: string,
  year: number | null
): Promise<ShowNews> {
  const ai = getClient(apiKey);
  const today = new Date().toISOString().slice(0, 10);
  const prompt = `Search the web for the latest news about the TV show "${title}"${year ? ` (${year})` : ""}. Today's date is ${today}.

Focus on:
- Renewal or cancellation status of upcoming seasons
- Confirmed or rumored release/premiere dates
- Production status (filming, post-production, delays)
- Any recent announcements from the network, streamer, cast, or showrunners

Write a concise update (3-6 short paragraphs or bullets) covering what's known about the show's return. If reliable news is sparse, say so plainly. Prefer information from the past 12 months. Cite sources inline by name where helpful.`;

  let response;
  try {
    response = await runGrounded(() =>
      ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          temperature: 0.4,
        },
      })
    );
  } catch (error) {
    throw asRateLimit(error) ?? error;
  }

  const summary = response.text ?? "";
  if (!summary) {
    throw new Error("Gemini returned empty news response");
  }

  type GroundingChunk = { web?: { uri?: string; title?: string } };
  const chunks =
    (response.candidates?.[0]?.groundingMetadata?.groundingChunks ??
      []) as GroundingChunk[];
  const seen = new Set<string>();
  const sources: NewsSource[] = [];
  for (const c of chunks) {
    const uri = c.web?.uri;
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    sources.push({ uri, title: c.web?.title ?? uri });
  }

  return { summary, sources };
}
