import { NextRequest, NextResponse } from "next/server";
import { securityHeadersMiddleware } from "@/lib/middleware/handlers/securityHeadersHandler";
import type { MiddlewareContext } from "@/lib/middleware/types";

describe("securityHeadersMiddleware", () => {
  it("reuses the entry point nonce and policy for downstream requests and responses", async () => {
    const nonce = "entry-point-nonce";
    const csp = `default-src 'self'; script-src 'nonce-${nonce}'`;
    const request = new NextRequest("https://worksphere.test/dashboard");
    const context: MiddlewareContext = {
      nonce,
      csp,
      requestHeaders: new Headers(request.headers),
    };

    const response = await securityHeadersMiddleware(
      request,
      context,
      async () => NextResponse.next(),
    );

    expect(context.nonce).toBe(nonce);
    expect(context.csp).toBe(csp);
    expect(context.requestHeaders?.get("x-csp-nonce")).toBe(nonce);
    expect(context.requestHeaders?.get("x-pathname")).toBe("/dashboard");
    expect(context.requestHeaders?.get("Content-Security-Policy")).toBe(csp);
    expect(response.headers.get("Content-Security-Policy")).toBe(csp);
  });
});
