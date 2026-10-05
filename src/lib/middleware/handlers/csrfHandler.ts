import { NextResponse, type NextRequest } from "next/server";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  CSRF_PROTECTED_METHODS,
  issueCsrfToken,
  verifyCsrfToken,
} from "@/lib/csrf";
import { isCsrfExemptRoute } from "../routes";
import type { MiddlewareHandler } from "../types";

/**
 * Ensures a valid signed CSRF cookie exists on safe (GET/HEAD/OPTIONS) requests,
 * and validates the cookie+header pair on mutating requests.
 */
export async function applyCsrfProtection(
  req: Request,
  res: NextResponse,
): Promise<NextResponse> {
  const url = new URL(req.url);
  const isApiRoute = url.pathname.startsWith("/api");

  const cookieHeader = req.headers.get("cookie") || "";
  const existingCookie = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${CSRF_COOKIE_NAME}=`))
    ?.slice(CSRF_COOKIE_NAME.length + 1);

  if (
    isApiRoute &&
    !isCsrfExemptRoute(req) &&
    CSRF_PROTECTED_METHODS.has(req.method)
  ) {
    const headerToken = req.headers.get(CSRF_HEADER_NAME);
    const isValid = await verifyCsrfToken(existingCookie, headerToken);
    if (!isValid) {
      return NextResponse.json(
        { error: "CSRF validation failed. Please refresh and try again." },
        { status: 403 },
      );
    }
    return res;
  }

  // Safe request: issue a token cookie if one isn't already set.
  if (!existingCookie && !isCsrfExemptRoute(req)) {
    const { cookieValue } = await issueCsrfToken();
    res.cookies.set(CSRF_COOKIE_NAME, cookieValue, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
  }

  return res;
}

export const csrfMiddleware: MiddlewareHandler = async (req, ctx, next) => {
  const res = await next();
  return await applyCsrfProtection(req, res);
};
