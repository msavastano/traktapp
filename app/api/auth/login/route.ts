import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAuthorizeUrl } from "@/lib/trakt";

/**
 * GET /api/auth/login
 *
 * Generates a CSRF state token, stores it in a cookie, and redirects
 * the user to Trakt's OAuth authorization page.
 */
export async function GET() {
  // Generate a random state for CSRF protection
  const state = crypto.randomUUID();

  const cookieStore = await cookies();
  cookieStore.set("trakt_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });

  const url = getAuthorizeUrl(state);
  return NextResponse.redirect(url);
}
