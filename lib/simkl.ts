/**
 * Simkl API client and authentication helpers.
 *
 * All token exchange and API calls go through this module.
 * Tokens are stored in HTTP-only cookies, encrypted with AES-256-GCM
 * using the TOKEN_ENCRYPTION_KEY env var (32-byte hex string).
 *
 * Two hosts are in play and mixing them up is the classic Simkl 404:
 *   simkl.com      — browser-facing OAuth consent page (/oauth/authorize)
 *   api.simkl.com  — everything else, including the token exchange
 */

import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

export const SIMKL_API_BASE = "https://api.simkl.com";
const SIMKL_AUTH_BASE = "https://simkl.com";

/**
 * Simkl requires `client_id`, `app-name` and `app-version` on *every* request
 * (public and authenticated alike), plus a descriptive User-Agent. These
 * identify the app for debugging and outage routing.
 */
const APP_NAME = "simklapp";
const APP_VERSION = "1.0";
const USER_AGENT = `${APP_NAME}/${APP_VERSION}`;

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

/**
 * Reads a required env var, throwing a named error instead of silently
 * producing `undefined` in a URL. A missing client_id used to surface as an
 * opaque `invalid_client` error from the OAuth provider.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

export function clientId(): string {
  return requireEnv("SIMKL_CLIENT_ID");
}

// ---------------------------------------------------------------------------
// URL + header construction
// ---------------------------------------------------------------------------

/**
 * Builds an api.simkl.com URL with the three always-required query params
 * merged in alongside any endpoint-specific ones.
 */
export function apiUrl(
  path: string,
  params: Record<string, string | number | undefined> = {}
): string {
  const url = new URL(path.startsWith("/") ? path : `/${path}`, SIMKL_API_BASE);
  url.searchParams.set("client_id", clientId());
  url.searchParams.set("app-name", APP_NAME);
  url.searchParams.set("app-version", APP_VERSION);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * Calendar feeds are served from a separate CDN host, not the API host —
 * api.simkl.com/calendar/... returns 404.
 */
export function cdnUrl(path: string): string {
  const url = new URL(
    path.startsWith("/") ? path : `/${path}`,
    "https://data.simkl.in"
  );
  url.searchParams.set("client_id", clientId());
  url.searchParams.set("app-name", APP_NAME);
  url.searchParams.set("app-version", APP_VERSION);
  return url.toString();
}

export function baseHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
  };
}

export function authHeaders(accessToken: string): Record<string, string> {
  return {
    ...baseHeaders(),
    Authorization: `Bearer ${accessToken}`,
  };
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

/**
 * Step 1 of the OAuth flow. Note this points at simkl.com, NOT api.simkl.com —
 * the API host has no /oauth/authorize page and will 404.
 */
export function getAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId(),
    redirect_uri: requireEnv("SIMKL_REDIRECT_URI"),
    state,
    "app-name": APP_NAME,
    "app-version": APP_VERSION,
  });
  return `${SIMKL_AUTH_BASE}/oauth/authorize?${params.toString()}`;
}

export interface SimklTokens {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
  /** Stamped locally at exchange time — Simkl does not return this. */
  created_at: number;
}

/**
 * Thrown for non-OK Simkl responses. `status` lets route handlers distinguish
 * a revoked token (401) from a transient failure.
 */
export class SimklApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "SimklApiError";
  }
}

/**
 * Fetch wrapper with retry on rate limits (429) and transient network errors.
 *
 * Simkl caps apps at 10 GET/sec and 1 POST/sec per client_id, and suspends
 * keys that sustain overage without warning — so callers should stay
 * sequential by default rather than fanning out.
 */
export async function fetchSimkl(
  url: string,
  options: RequestInit = {},
  maxRetries = 5
): Promise<Response> {
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      const res = await fetch(url, options);
      if (res.status === 429 && attempt <= maxRetries) {
        const retryAfterHeader = res.headers.get("Retry-After");
        const delaySeconds = retryAfterHeader
          ? parseInt(retryAfterHeader, 10)
          : null;
        const delayMs =
          (delaySeconds && Number.isFinite(delaySeconds) && delaySeconds > 0
            ? delaySeconds
            : Math.pow(2, attempt)) * 1000;
        console.warn(
          `[Simkl API] Rate limited (429) on ${url}. Retrying attempt ${attempt}/${maxRetries} after ${delayMs}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      return res;
    } catch (err) {
      if (attempt > maxRetries) {
        throw err;
      }
      const delayMs = Math.pow(2, attempt) * 1000;
      console.warn(
        `[Simkl API] Network error on ${url}. Retrying attempt ${attempt}/${maxRetries} after ${delayMs}ms...`,
        err
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/**
 * Step 2 of the OAuth flow, against api.simkl.com.
 *
 * The authorization `code` is single-use and is consumed even when the
 * exchange fails — never retry with the same code, restart the flow instead.
 */
export async function exchangeCodeForTokens(
  code: string
): Promise<SimklTokens> {
  const res = await fetchSimkl(`${SIMKL_API_BASE}/oauth/token`, {
    method: "POST",
    headers: baseHeaders(),
    body: JSON.stringify({
      code,
      client_id: clientId(),
      client_secret: requireEnv("SIMKL_CLIENT_SECRET"),
      redirect_uri: requireEnv("SIMKL_REDIRECT_URI"),
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new SimklApiError(
      `Token exchange failed (${res.status}): ${text}`,
      res.status
    );
  }

  const tokens = await res.json();
  return { ...tokens, created_at: Math.floor(Date.now() / 1000) };
}

// ---------------------------------------------------------------------------
// Authenticated API calls
// ---------------------------------------------------------------------------

export interface SimklUser {
  name: string;
  /** Avatar URL — Simkl returns a fully-qualified URL here, not a path. */
  avatar?: string;
  ids: { simkl: number; slug?: string };
  joined_at?: string;
  gender?: string;
  bio?: string;
}

export interface SimklUserSettings {
  user: SimklUser;
  account: {
    id: number;
    timezone?: string;
    type?: string;
  };
  connections?: Record<string, boolean>;
}

/**
 * The authenticated user's profile.
 *
 * This is a POST despite being a read — that's Simkl's contract, not a typo.
 */
export async function fetchUserSettings(
  accessToken: string
): Promise<SimklUserSettings> {
  const res = await fetchSimkl(apiUrl("/users/settings"), {
    method: "POST",
    headers: authHeaders(accessToken),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new SimklApiError(
      `Failed to fetch user settings (${res.status})`,
      res.status
    );
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Response normalisation
// ---------------------------------------------------------------------------

/**
 * Simkl is inconsistent about the internal id key: the library and detail
 * endpoints return `ids.simkl`, while search, `/tv/premieres/*` and
 * `/tv/airing` return `ids.simkl_id`. Everything downstream expects
 * `ids.simkl`, so normalise once here rather than guessing per call site.
 *
 * Also strips the relative `url` field these endpoints include, since
 * lib/images.ts builds canonical Simkl links from the id and slug instead.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeShow(raw: any): SimklShowShape | null {
  if (!raw) return null;
  const ids = raw.ids ?? {};
  const simkl = ids.simkl ?? ids.simkl_id;
  if (simkl == null) return null;

  return {
    ...raw,
    // Search reports the episode count as `ep_count`; the detail endpoint
    // calls it `total_episodes`. Normalise to the latter.
    total_episodes: raw.total_episodes ?? raw.ep_count,
    ids: {
      ...ids,
      simkl: Number(simkl),
      slug: ids.slug ?? deriveSlug(raw.url),
    },
  };
}

/** Pulls the slug out of a relative url like "/tv/1197910/house-of-the-dragon". */
function deriveSlug(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  const parts = url.split("/").filter(Boolean);
  return parts.length >= 3 ? parts[2] : undefined;
}

interface SimklShowShape {
  title: string;
  year?: number | null;
  ids: { simkl: number; slug?: string; [key: string]: unknown };
  [key: string]: unknown;
}

// Image and deep-link helpers live in lib/images.ts so client components can
// import them without pulling node:crypto into the browser bundle.
export {
  posterUrl,
  posterFrom,
  POSTER_PLACEHOLDER,
  simklShowUrl,
  simklMovieUrl,
} from "./images";

// ---------------------------------------------------------------------------
// Token cookie helpers
// ---------------------------------------------------------------------------

/**
 * Distinct from the old Trakt cookie name so stale sessions from the previous
 * provider are ignored rather than half-decoding into an unusable token.
 */
const COOKIE_NAME = "simkl_tokens";

// AES-256-GCM cookie encryption.
//
// Layout of the encoded cookie value (base64):
//   [ 12-byte IV ][ 16-byte auth tag ][ ciphertext ]
//
// The encryption key is loaded from TOKEN_ENCRYPTION_KEY (64 hex chars = 32 bytes).
// Rotating that env var invalidates all existing sessions — users re-login.

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function getEncryptionKey(): Buffer {
  const hex = requireEnv("TOKEN_ENCRYPTION_KEY");
  if (hex.length !== 64) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must be 64 hex chars (32 bytes); got ${hex.length}`
    );
  }
  return Buffer.from(hex, "hex");
}

export function encodeTokens(tokens: SimklTokens): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(tokens), "utf-8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decodeTokens(encoded: string): SimklTokens | null {
  try {
    const key = getEncryptionKey();
    const buf = Buffer.from(encoded, "base64");
    if (buf.length < IV_LEN + TAG_LEN) return null;
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf-8"));
  } catch {
    return null;
  }
}

export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 365 * 24 * 60 * 60, // Simkl tokens are effectively permanent
  path: "/",
};

export { COOKIE_NAME };
