import { NextRequest, NextResponse } from "next/server";
import {
  REFRESH_COOKIE_NAME,
  ACCESS_COOKIE_NAME,
  rotateRefreshToken,
  getRefreshCookieOptions,
} from "@/lib/auth/sessionTokens";

/**
 * POST /api/auth/session/refresh
 *
 * Silently rotates the refresh token stored in an httpOnly cookie and issues
 * a fresh short-lived access JWT token.
 */
export async function POST(req: NextRequest) {
  try {
    const refreshTokenCookie = req.cookies.get(REFRESH_COOKIE_NAME)?.value;
    let refreshToken = refreshTokenCookie;

    if (!refreshToken) {
      // Allow fallback if sent in request body
      try {
        const body = await req.json();
        if (body?.refreshToken && typeof body.refreshToken === "string") {
          refreshToken = body.refreshToken;
        }
      } catch {
        // Body parsing may fail if no body provided
      }
    }

    if (!refreshToken) {
      return NextResponse.json(
        { error: "No refresh token provided", code: "REFRESH_TOKEN_MISSING" },
        { status: 401 },
      );
    }

    const result = await rotateRefreshToken(refreshToken);

    if (!result.success) {
      const response = NextResponse.json(
        {
          error: "Session expired or invalid. Please sign in again.",
          code: result.error,
        },
        { status: 401 },
      );
      // Clear expired / invalid cookie
      response.cookies.delete(REFRESH_COOKIE_NAME);
      response.cookies.delete(ACCESS_COOKIE_NAME);
      return response;
    }

    const response = NextResponse.json({
      success: true,
      accessToken: result.accessToken,
      userId: result.userId,
      expiresAt: result.expiresAt,
    });

    // Store rotated refresh token securely in httpOnly cookie
    response.cookies.set(
      REFRESH_COOKIE_NAME,
      result.refreshToken,
      getRefreshCookieOptions(),
    );

    return response;
  } catch (err) {
    console.error("[session/refresh] Error rotating refresh token:", err);
    return NextResponse.json(
      { error: "Internal server error while refreshing session" },
      { status: 500 },
    );
  }
}
