import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  decodeTokens,
  refreshAccessToken,
  encodeTokens,
  COOKIE_NAME,
} from "@/lib/trakt";

/**
 * POST /api/auth/refresh
 *
 * Refreshes the Trakt access token using the stored refresh token.
 * Returns the new access token for the current request.
 */
export async function POST() {
  const cookieStore = await cookies();
  const encoded = cookieStore.get(COOKIE_NAME)?.value;

  if (!encoded) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const tokens = decodeTokens(encoded);
  if (!tokens) {
    cookieStore.delete(COOKIE_NAME);
    return NextResponse.json({ error: "Invalid token data" }, { status: 401 });
  }

  try {
    const newTokens = await refreshAccessToken(tokens.refresh_token);

    cookieStore.set(COOKIE_NAME, encodeTokens(newTokens), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 90 * 24 * 60 * 60,
      path: "/",
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Token refresh failed:", error);
    cookieStore.delete(COOKIE_NAME);
    return NextResponse.json(
      { error: "Token refresh failed" },
      { status: 401 }
    );
  }
}
