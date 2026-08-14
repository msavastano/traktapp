/**
 * Route-handler session helpers.
 *
 * Every authenticated route needs the same three steps: read the cookie,
 * decode it, and bail with a 401 if either fails. Simkl tokens are long-lived
 * (5 years) and have no refresh grant, so there is no refresh branch here —
 * a 401 from the API means the user revoked the app in their Simkl Connected
 * Apps settings, and the only remedy is to re-run the OAuth flow.
 */

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { decodeTokens, COOKIE_NAME, type SimklTokens } from "./simkl";

export type SessionResult =
  | { ok: true; tokens: SimklTokens }
  | { ok: false; response: NextResponse };

/**
 * Resolves the current session, or returns the 401 response to hand straight
 * back to the client.
 */
export async function getSession(): Promise<SessionResult> {
  const cookieStore = await cookies();
  const encoded = cookieStore.get(COOKIE_NAME)?.value;

  if (!encoded) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      ),
    };
  }

  const tokens = decodeTokens(encoded);
  if (!tokens) {
    cookieStore.delete(COOKIE_NAME);
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid token data" },
        { status: 401 }
      ),
    };
  }

  return { ok: true, tokens };
}

/** Clears the session cookie after Simkl reports the token is no longer valid. */
export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
