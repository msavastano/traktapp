/**
 * Trakt API client and authentication helpers.
 *
 * All token exchange and API calls go through this module.
 * Tokens are stored in HTTP-only cookies, encrypted with a simple
 * XOR-based obfuscation (upgrade to proper AES in production).
 */

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

export async function exchangeCodeForTokens(
  code: string
): Promise<TraktTokens> {
  const res = await fetch(`${TRAKT_API_BASE}/oauth/token`, {
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
  const res = await fetch(`${TRAKT_API_BASE}/oauth/token`, {
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
  await fetch(`${TRAKT_API_BASE}/oauth/revoke`, {
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
  const res = await fetch(`${TRAKT_API_BASE}/users/settings`, {
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

/**
 * Encode tokens to a base64 JSON string for cookie storage.
 * In production, replace this with AES-256-GCM encryption.
 */
export function encodeTokens(tokens: TraktTokens): string {
  return Buffer.from(JSON.stringify(tokens)).toString("base64");
}

export function decodeTokens(encoded: string): TraktTokens | null {
  try {
    const json = Buffer.from(encoded, "base64").toString("utf-8");
    return JSON.parse(json);
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
