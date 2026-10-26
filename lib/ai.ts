import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";

// Model used for every AI feature in the app.
export const MODEL = "claude-haiku-5-5";

// Raised when Anthropic returns 429. Carries the retry delay (ms) from the
// response's retry-after header so callers can surface it to the user.
export class RateLimitError extends Error {
  retryAfterMs: number;
  // "per-minute" → the API gave a short retry-after, so retrying soon makes
  // sense; "unknown" → no usable delay was supplied.
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

// Turn SDK errors into messages a user can act on. Rate limits become our
// RateLimitError so the routes can return a 429 with retry info.
function translateError(error: unknown): unknown {
  if (error instanceof Anthropic.RateLimitError) {
    const header = error.headers?.get("retry-after");
    const seconds = header ? Number(header) : NaN;
    const retryAfterMs = Number.isFinite(seconds) ? Math.ceil(seconds * 1000) : 0;
    const retryable = retryAfterMs > 0 && retryAfterMs <= 120_000;
    return new RateLimitError(
      "Anthropic rate limit hit. Try again in a moment.",
      {
        retryAfterMs,
        scope: retryable ? "per-minute" : "unknown",
        retryable,
      }
    );
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return new Error(
      "Your Anthropic API key was rejected. Check it in the API key settings."
    );
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return new Error(
      "Your Anthropic API key doesn't have access to this feature."
    );
  }
  return error;
}

// Bring-your-own-key: callers pass the end user's Anthropic API key (entered in
// the browser and forwarded per request). A new client is created per key so
// keys are never shared or cached across users.
function getClient(apiKey: string): Anthropic {
  if (!apiKey) {
    throw new Error("An Anthropic API key is required");
  }
  return new Anthropic({ apiKey });
}

function refusalError(response: Anthropic.Message): Error | null {
  if (response.stop_reason !== "refusal") return null;
  const why = response.stop_details?.explanation;
  return new Error(
    `Claude declined this request${why ? `: ${why}` : "."}`
  );
}

export interface TasteShow {
  title: string;
  year: number | null;
  genres?: string[];
  rating?: number;
  status?: string;
  watched: boolean;
}

export interface AiRecommendation {
  title: string;
  year: number;
  reason: string;
  genres: string[];
}

const recommendationsFormat = jsonSchemaOutputFormat({
  type: "object",
  properties: {
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          year: { type: "integer" },
          reason: { type: "string" },
          genres: { type: "array", items: { type: "string" } },
        },
        required: ["title", "year", "reason", "genres"],
        additionalProperties: false,
      },
    },
  },
  required: ["recommendations"],
  additionalProperties: false,
});

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
): Promise<AiRecommendation[]> {
  const client = getClient(apiKey);
  let response;
  try {
    response = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      messages: [{ role: "user", content: buildPrompt(taste, count) }],
      output_config: {
        effort: "medium",
        format: recommendationsFormat,
      },
    });
  } catch (error) {
    throw translateError(error);
  }

  const refused = refusalError(response);
  if (refused) throw refused;

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error("Claude returned an empty or invalid response");
  }
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

// Server tools can pause a long turn; resume it this many times at most.
const MAX_PAUSE_RESUMES = 2;

export async function generateShowNews(
  apiKey: string,
  title: string,
  year: number | null
): Promise<ShowNews> {
  const client = getClient(apiKey);
  const today = new Date().toISOString().slice(0, 10);
  const prompt = `Search the web for the latest news about the TV show "${title}"${year ? ` (${year})` : ""}. Today's date is ${today}.

Focus on:
- Renewal or cancellation status of upcoming seasons
- Confirmed or rumored release/premiere dates
- Production status (filming, post-production, delays)
- Any recent announcements from the network, streamer, cast, or showrunners

Write a concise update (3-6 short paragraphs or bullets) covering what's known about the show's return. If reliable news is sparse, say so plainly. Prefer information from the past 12 months. Cite sources inline by name where helpful. Reply with the update only, with no preamble about searching.`;

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
  const content: Anthropic.ContentBlock[] = [];
  let response: Anthropic.Message;
  try {
    for (let attempt = 0; ; attempt++) {
      response = await client.messages.create({
        model: MODEL,
        max_tokens: 16000,
        messages,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
        output_config: { effort: "low" },
      });
      content.push(...response.content);
      if (response.stop_reason !== "pause_turn" || attempt >= MAX_PAUSE_RESUMES) {
        break;
      }
      // Resume the paused turn by sending its content back as-is.
      messages.push({ role: "assistant", content: response.content });
    }
  } catch (error) {
    throw translateError(error);
  }

  const refused = refusalError(response);
  if (refused) throw refused;

  // The final answer comes after the last search result; earlier text blocks
  // are the model narrating its searches.
  let lastResultIdx = -1;
  content.forEach((b, i) => {
    if (b.type === "web_search_tool_result") lastResultIdx = i;
  });
  const summary = content
    .slice(lastResultIdx + 1)
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!summary) {
    throw new Error("Claude returned an empty news response");
  }

  // Prefer the pages Claude actually cited; fall back to every search result.
  const seen = new Set<string>();
  const sources: NewsSource[] = [];
  const add = (uri: string | undefined, sourceTitle: string | null | undefined) => {
    if (!uri || seen.has(uri)) return;
    seen.add(uri);
    sources.push({ uri, title: sourceTitle || uri });
  };
  for (const b of content) {
    if (b.type !== "text") continue;
    for (const c of b.citations ?? []) {
      if (c.type === "web_search_result_location") add(c.url, c.title);
    }
  }
  if (sources.length === 0) {
    for (const b of content) {
      if (b.type !== "web_search_tool_result" || !Array.isArray(b.content)) continue;
      for (const r of b.content) add(r.url, r.title);
    }
  }

  return { summary, sources };
}
