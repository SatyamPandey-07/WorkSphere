import { NextRequest, NextResponse } from "next/server";
import {
  REFRESH_COOKIE_NAME,
  ACCESS_COOKIE_NAME,
  revokeRefreshTokenFamily,
} from "@/lib/auth/sessionTokens";

/**
 * POST /api/auth/session/logout
 *
 * Revokes the current refresh token family and clears session cookies.
 */
export async function POST(req: NextRequest) {
  try {
    const refreshToken = req.cookies.get(REFRESH_COOKIE_NAME)?.value;
    if (refreshToken) {
      await revokeRefreshTokenFamily(refreshToken);
    }

    const response = NextResponse.json({
      success: true,
      message: "Logged out successfully.",
    });

    response.cookies.delete(REFRESH_COOKIE_NAME);
    response.cookies.delete(ACCESS_COOKIE_NAME);
    response.cookies.delete("worksphere_demo_session");
    response.cookies.delete("worksphere_user_email");

    return response;
  } catch (err) {
    console.error("[session/logout] Error logging out:", err);
    return NextResponse.json(
      { error: "Internal server error during logout" },
      { status: 500 },
    );
  }
}
