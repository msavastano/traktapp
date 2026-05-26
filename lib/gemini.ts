import { GoogleGenAI, Type } from "@google/genai";

const MODEL = "gemini-3.1-flash-lite";

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (client) return client;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }
  client = new GoogleGenAI({ apiKey });
  return client;
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
  taste: TasteShow[],
  count: number = 12
): Promise<GeminiRecommendation[]> {
  const ai = getClient();
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: buildPrompt(taste, count),
    config: {
      responseMimeType: "application/json",
      responseSchema,
      temperature: 0.8,
    },
  });

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
  title: string,
  year: number | null
): Promise<ShowNews> {
  const ai = getClient();
  const today = new Date().toISOString().slice(0, 10);
  const prompt = `Search the web for the latest news about the TV show "${title}"${year ? ` (${year})` : ""}. Today's date is ${today}.

Focus on:
- Renewal or cancellation status of upcoming seasons
- Confirmed or rumored release/premiere dates
- Production status (filming, post-production, delays)
- Any recent announcements from the network, streamer, cast, or showrunners

Write a concise update (3-6 short paragraphs or bullets) covering what's known about the show's return. If reliable news is sparse, say so plainly. Prefer information from the past 12 months. Cite sources inline by name where helpful.`;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
      temperature: 0.4,
    },
  });

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
