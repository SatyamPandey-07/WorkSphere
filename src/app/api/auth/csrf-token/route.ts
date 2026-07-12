import { NextResponse } from "next/server";
import { CSRF_COOKIE_NAME, issueCsrfToken } from "@/lib/csrf";

/**
 * Issues a brand-new signed CSRF token, sets it as an httpOnly cookie, and
 * returns the raw (unsigned) half to the client so it can be echoed back as
 * the `x-csrf-token` header on subsequent mutating requests.
 *
 * The client should call this:
 *  - once on initial app load, and
 *  - again any time it detects a transition that could plausibly invalidate
 *    client-side assumptions about the token (e.g. locale switch, tab refocus
 *    after a long idle period, or a previous 403 from this same check).
 */
export async function GET() {
  const { cookieValue, raw } = await issueCsrfToken();

  const response = NextResponse.json({ csrfToken: raw });
  response.cookies.set(CSRF_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  return response;
}
