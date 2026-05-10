import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { decodeTokens, revokeToken, COOKIE_NAME } from "@/lib/trakt";

/**
 * POST /api/auth/logout
 *
 * Revokes the access token with Trakt and clears the auth cookie.
 */
export async function POST() {
  const cookieStore = await cookies();
  const encoded = cookieStore.get(COOKIE_NAME)?.value;

  if (encoded) {
    const tokens = decodeTokens(encoded);
    if (tokens) {
      try {
        await revokeToken(tokens.access_token);
      } catch (error) {
        console.error("Token revocation failed:", error);
        // Continue with cookie deletion even if revocation fails
      }
    }
  }

  cookieStore.delete(COOKIE_NAME);
  return NextResponse.json({ success: true });
}
