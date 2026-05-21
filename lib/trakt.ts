/**
 * Trakt API client and authentication helpers.
 *
 * All token exchange and API calls go through this module.
 * Tokens are stored in HTTP-only cookies, encrypted with AES-256-GCM
 * using the TOKEN_ENCRYPTION_KEY env var (32-byte hex string).
 */

import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

const TRAKT_API_BASE = "https://api.trakt.tv";
const TRAKT_AUTH_BASE = "https://trakt.tv";
const USER_AGENT = "TraktApp/1.0 (Next.js; +http://localhost:3000)";

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

function baseHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    "trakt-api-key": process.env.TRAKT_CLIENT_ID!,
    "trakt-api-version": "2",
  };
}

function authHeaders(accessToken: string): Record<string, string> {
  return {
    ...baseHeaders(),
    Authorization: `Bearer ${accessToken}`,
  };
}

// ---------------------------------------------------------------------------
// OAuth URLs
// ---------------------------------------------------------------------------

export function getAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.TRAKT_CLIENT_ID!,
    redirect_uri: process.env.NEXT_PUBLIC_TRAKT_REDIRECT_URI!,
    state,
  });
  return `${TRAKT_AUTH_BASE}/oauth/authorize?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

export interface TraktTokens {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
  created_at: number;
}

/**
 * Helper to fetch from Trakt with automatic retry on rate limits (429).
 */
export async function fetchTrakt(
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
        const delaySeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : null;
        const delayMs = (delaySeconds && Number.isFinite(delaySeconds) && delaySeconds > 0 
          ? delaySeconds 
          : Math.pow(2, attempt)) * 1000;
        console.warn(`[Trakt API] Rate limited (429) on ${url}. Retrying attempt ${attempt}/${maxRetries} after ${delayMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      return res;
    } catch (err) {
      if (attempt > maxRetries) {
        throw err;
      }
      const delayMs = Math.pow(2, attempt) * 1000;
      console.warn(`[Trakt API] Network error on ${url}. Retrying attempt ${attempt}/${maxRetries} after ${delayMs}ms...`, err);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export async function exchangeCodeForTokens(
  code: string
): Promise<TraktTokens> {
  const res = await fetchTrakt(`${TRAKT_API_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({
      code,
      client_id: process.env.TRAKT_CLIENT_ID!,
      client_secret: process.env.TRAKT_CLIENT_SECRET!,
      redirect_uri: process.env.NEXT_PUBLIC_TRAKT_REDIRECT_URI!,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  return res.json();
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<TraktTokens> {
  const res = await fetchTrakt(`${TRAKT_API_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({
      refresh_token: refreshToken,
      client_id: process.env.TRAKT_CLIENT_ID!,
      client_secret: process.env.TRAKT_CLIENT_SECRET!,
      redirect_uri: process.env.NEXT_PUBLIC_TRAKT_REDIRECT_URI!,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }

  return res.json();
}

export async function revokeToken(accessToken: string): Promise<void> {
  await fetchTrakt(`${TRAKT_API_BASE}/oauth/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({
      token: accessToken,
      client_id: process.env.TRAKT_CLIENT_ID!,
      client_secret: process.env.TRAKT_CLIENT_SECRET!,
    }),
  });
}

// ---------------------------------------------------------------------------
// Authenticated API calls
// ---------------------------------------------------------------------------

export interface TraktUser {
  username: string;
  private: boolean;
  name: string;
  vip: boolean;
  vip_ep: boolean;
  ids: { slug: string; uuid: string };
  images?: {
    avatar?: { full: string };
  };
}

export interface TraktUserSettings {
  user: TraktUser;
  account: {
    timezone: string;
    date_format: string;
    time_24hr: boolean;
    cover_image: string | null;
  };
}

export async function fetchUserSettings(
  accessToken: string
): Promise<TraktUserSettings> {
  const res = await fetchTrakt(`${TRAKT_API_BASE}/users/settings`, {
    headers: authHeaders(accessToken),
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch user settings (${res.status})`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Token cookie helpers
// ---------------------------------------------------------------------------

const COOKIE_NAME = "trakt_tokens";

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
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  }
  if (hex.length !== 64) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must be 64 hex chars (32 bytes); got ${hex.length}`
    );
  }
  return Buffer.from(hex, "hex");
}

export function encodeTokens(tokens: TraktTokens): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(tokens), "utf-8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decodeTokens(encoded: string): TraktTokens | null {
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

export function isTokenExpired(tokens: TraktTokens): boolean {
  const expiresAt = (tokens.created_at + tokens.expires_in) * 1000;
  // Add 60s buffer to avoid edge cases
  return Date.now() > expiresAt - 60_000;
}

export { COOKIE_NAME };
