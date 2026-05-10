import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCodeForTokens, encodeTokens, COOKIE_NAME } from "@/lib/trakt";

/**
 * GET /api/auth/callback
 *
 * Trakt redirects here after the user authorizes.
 * Validates the CSRF state, exchanges the code for tokens,
 * stores tokens in an HTTP-only cookie, and redirects to /dashboard.
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
  const savedState = cookieStore.get("trakt_oauth_state")?.value;

  if (!state || state !== savedState) {
    return NextResponse.redirect(new URL("/?error=invalid_state", request.url));
  }

  // Clean up state cookie
  cookieStore.delete("trakt_oauth_state");

  try {
    const tokens = await exchangeCodeForTokens(code);

    // Store tokens in HTTP-only cookie
    const encoded = encodeTokens(tokens);
    cookieStore.set(COOKIE_NAME, encoded, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 90 * 24 * 60 * 60, // 90 days (refresh token lifetime)
      path: "/",
    });

    return NextResponse.redirect(new URL("/dashboard", request.url));
  } catch (error) {
    console.error("Token exchange failed:", error);
    return NextResponse.redirect(
      new URL("/?error=token_exchange_failed", request.url)
    );
  }
}
