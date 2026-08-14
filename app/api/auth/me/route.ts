import { NextResponse } from "next/server";
import { fetchUserSettings, SimklApiError } from "@/lib/simkl";
import { getSession, clearSession } from "@/lib/session";

/**
 * GET /api/auth/me
 *
 * Returns the current authenticated user's profile.
 *
 * There is no token-refresh branch: Simkl tokens last 5 years and have no
 * refresh grant. A 401 means the user revoked the app from their Simkl
 * Connected Apps settings, so the cookie is cleared and they re-authorize.
 */
export async function GET() {
  const session = await getSession();
  if (!session.ok) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  try {
    const settings = await fetchUserSettings(session.tokens.access_token);
    return NextResponse.json({
      user: {
        username: settings.user.ids?.slug ?? String(settings.user.ids?.simkl),
        name: settings.user.name,
        avatar: settings.user.avatar ?? null,
        vip: settings.account?.type === "vip",
      },
    });
  } catch (error) {
    if (error instanceof SimklApiError && error.status === 401) {
      await clearSession();
      return NextResponse.json({ user: null }, { status: 401 });
    }
    console.error("Failed to fetch user:", error);
    return NextResponse.json({ error: "Failed to fetch user" }, { status: 500 });
  }
}
