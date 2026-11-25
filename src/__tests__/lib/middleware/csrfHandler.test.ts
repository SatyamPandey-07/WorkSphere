import { NextRequest, NextResponse } from "next/server";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  issueCsrfToken,
} from "@/lib/csrf";
import { csrfMiddleware } from "@/lib/middleware/handlers/csrfHandler";
import type { MiddlewareContext } from "@/lib/middleware/types";

jest.mock("@clerk/nextjs/server", () => ({
  createRouteMatcher:
    (patterns: string[]) => (request: { nextUrl: { pathname: string } }) =>
      patterns.some((pattern) =>
        new RegExp(`^${pattern.replace(/\(\.\*\)/g, ".*")}$`).test(
          request.nextUrl.pathname,
        ),
      ),
}));

const next = jest.fn(async () => NextResponse.next());

function request(path: string, method: string, headers?: HeadersInit) {
  return new NextRequest(`https://worksphere.test${path}`, {
    method,
    headers,
  });
}

describe("csrfMiddleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects state-changing API requests without a valid token pair", async () => {
    const response = await csrfMiddleware(
      request("/api/bookings", "POST"),
      {} as MiddlewareContext,
      next,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "CSRF validation failed. Please refresh and try again.",
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("accepts a valid signed double-submit cookie and header", async () => {
    const token = await issueCsrfToken();
    const response = await csrfMiddleware(
      request("/api/bookings", "POST", {
        cookie: `${CSRF_COOKIE_NAME}=${token.cookieValue}`,
        [CSRF_HEADER_NAME]: token.raw,
      }),
      {} as MiddlewareContext,
      next,
    );

    expect(response.status).toBe(200);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("preserves documented webhook CSRF exemptions", async () => {
    const response = await csrfMiddleware(
      request("/api/webhooks/worker", "POST"),
      {} as MiddlewareContext,
      next,
    );

    expect(response.status).toBe(200);
    expect(response.cookies.get(CSRF_COOKIE_NAME)).toBeUndefined();
  });

  it("issues a CSRF cookie on an eligible safe request", async () => {
    const response = await csrfMiddleware(
      request("/dashboard", "GET"),
      {} as MiddlewareContext,
      next,
    );

    expect(response.cookies.get(CSRF_COOKIE_NAME)?.value).toContain(".");
  });
});
