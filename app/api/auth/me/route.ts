import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  decodeTokens,
  isTokenExpired,
  refreshAccessToken,
  encodeTokens,
  fetchUserSettings,
  COOKIE_NAME,
} from "@/lib/trakt";

/**
 * GET /api/auth/me
 *
 * Returns the current authenticated user's profile.
 * Auto-refreshes tokens if expired.
 */
export async function GET() {
  const cookieStore = await cookies();
  const encoded = cookieStore.get(COOKIE_NAME)?.value;

  if (!encoded) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  let tokens = decodeTokens(encoded);
  if (!tokens) {
    cookieStore.delete(COOKIE_NAME);
    return NextResponse.json({ user: null }, { status: 401 });
  }

  // Auto-refresh if expired
  if (isTokenExpired(tokens)) {
    try {
      tokens = await refreshAccessToken(tokens.refresh_token);
      cookieStore.set(COOKIE_NAME, encodeTokens(tokens), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 90 * 24 * 60 * 60,
        path: "/",
      });
    } catch {
      cookieStore.delete(COOKIE_NAME);
      return NextResponse.json({ user: null }, { status: 401 });
    }
  }

  try {
    const settings = await fetchUserSettings(tokens.access_token);
    return NextResponse.json({
      user: {
        username: settings.user.username,
        name: settings.user.name,
        avatar: settings.user.images?.avatar?.full ?? null,
        vip: settings.user.vip,
      },
    });
  } catch (error) {
    console.error("Failed to fetch user:", error);
    return NextResponse.json(
      { error: "Failed to fetch user" },
      { status: 500 }
    );
  }
}
