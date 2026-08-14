import { NextResponse } from "next/server";
import { clearSession } from "@/lib/session";

/**
 * POST /api/auth/logout
 *
 * Clears the auth cookie.
 *
 * Unlike Trakt, Simkl exposes no token-revocation endpoint — tokens are
 * revoked by the user from https://simkl.com/settings/connected-apps/.
 * Dropping the cookie ends the session as far as this app is concerned.
 */
export async function POST() {
  await clearSession();
  return NextResponse.json({ success: true });
}
