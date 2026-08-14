import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAuthorizeUrl } from "@/lib/simkl";

/**
 * GET /api/auth/login
 *
 * Generates a CSRF state token, stores it in a cookie, and redirects
 * the user to Simkl's OAuth authorization page.
 */
export async function GET() {
  // Generate a random state for CSRF protection
  const state = crypto.randomUUID();

  const cookieStore = await cookies();
  cookieStore.set("simkl_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });

  try {
    return NextResponse.redirect(getAuthorizeUrl(state));
  } catch (error) {
    // Missing SIMKL_CLIENT_ID / SIMKL_REDIRECT_URI. Fail loudly here rather
    // than redirecting to Simkl with an empty client_id, which surfaces as an
    // opaque "invalid_client" error page on their side.
    console.error("Failed to build authorize URL:", error);
    return NextResponse.json(
      { error: "OAuth is not configured" },
      { status: 500 }
    );
  }
}
