import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  exchangeCodeForTokens,
  encodeTokens,
  COOKIE_NAME,
  COOKIE_OPTIONS,
} from "@/lib/simkl";

/**
 * GET /api/auth/callback
 *
 * Simkl redirects here after the user authorizes.
 * Validates the CSRF state, exchanges the code for a token,
 * stores it in an HTTP-only cookie, and redirects to /dashboard.
 *
 * Note: if the user declines consent, Simkl redirects to its own homepage
 * rather than back here with `error=access_denied` — so a denial simply never
 * reaches this handler.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (!code) {
    return NextResponse.redirect(new URL("/?error=no_code", request.url));
  }

  // Validate CSRF state
  const cookieStore = await cookies();
  const savedState = cookieStore.get("simkl_oauth_state")?.value;

  if (!state || state !== savedState) {
    return NextResponse.redirect(new URL("/?error=invalid_state", request.url));
  }

  // Clean up state cookie
  cookieStore.delete("simkl_oauth_state");

  try {
    const tokens = await exchangeCodeForTokens(code);
    cookieStore.set(COOKIE_NAME, encodeTokens(tokens), COOKIE_OPTIONS);
    return NextResponse.redirect(new URL("/dashboard", request.url));
  } catch (error) {
    // The code is single-use and is consumed even on failure — the user has
    // to restart the flow from /api/auth/login rather than retrying here.
    console.error("Token exchange failed:", error);
    return NextResponse.redirect(
      new URL("/?error=token_exchange_failed", request.url)
    );
  }
}
