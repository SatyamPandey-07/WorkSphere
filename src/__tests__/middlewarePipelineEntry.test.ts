import { NextRequest, NextResponse } from "next/server";

jest.mock("@clerk/nextjs/server", () => {
  const auth = Object.assign(jest.fn(), { protect: jest.fn() });
  const routeMatcher = (patterns: string[]) => (request: NextRequest) => {
    const path = request.nextUrl.pathname;
    return patterns.some((pattern) => {
      const regex = new RegExp(
        `^${pattern.replace(/\(\.\*\)/g, ".*").replace(/:[^/]+\*/g, ".*")}$`,
      );
      return regex.test(path);
    });
  };
  const clerkMiddleware = jest.fn(
    (handler: (auth: typeof auth, request: NextRequest) => Promise<NextResponse>) =>
      async (request: NextRequest, _event: unknown) => {
        let response: NextResponse;
        try {
          response = await handler(auth, request);
        } catch (error) {
          if (!(error instanceof NextResponse)) {
            throw error;
          }
          response = error;
        }
        response.cookies.set("clerk-session", "preserved");
        response.headers.set("x-clerk-middleware", "ran");
        return response;
      },
  );
  return {
    clerkMiddleware,
    createRouteMatcher: jest.fn(routeMatcher),
    __mockAuth: auth,
  };
});

jest.mock("@/lib/middleware/chain", () => ({
  runMiddlewarePipeline: jest.fn(async (_request, context) => {
    const response = NextResponse.next({
      request: { headers: context.requestHeaders },
    });
    response.headers.set("x-pipeline-ran", "true");
    return response;
  }),
}));

import { middleware, config } from "../middleware";
import { runMiddlewarePipeline } from "@/lib/middleware/chain";
import { middlewareMatcher } from "@/lib/middleware/routes";

const mockClerkAuth = (
  jest.requireMock("@clerk/nextjs/server") as {
    __mockAuth: jest.Mock & { protect: jest.Mock };
  }
).__mockAuth;

describe("Next.js middleware pipeline entry point", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClerkAuth.mockResolvedValue({
      userId: "user-1",
      sessionClaims: { metadata: { role: "member" } },
    });
    mockClerkAuth.protect.mockResolvedValue({
      userId: "user-1",
      sessionClaims: { metadata: { role: "member" } },
    });
  });

  it("runs the centralized pipeline with Clerk auth and nonce context", async () => {
    const request = new NextRequest("https://worksphere.test/venues");
    const response = await middleware(request, {} as never);
    const [pipelineRequest, context] = (
      runMiddlewarePipeline as jest.Mock
    ).mock.calls[0];

    expect(runMiddlewarePipeline).toHaveBeenCalledTimes(1);
    expect(pipelineRequest.nextUrl.pathname).toBe("/venues");
    expect(await context.auth()).toMatchObject({
      userId: "user-1",
      sessionClaims: { metadata: { role: "member" } },
    });
    expect(await context.protect()).toMatchObject({ userId: "user-1" });
    expect(mockClerkAuth.protect).toHaveBeenCalledTimes(1);
    expect(response.headers.get("x-pipeline-ran")).toBe("true");
    expect(response.headers.get("x-clerk-middleware")).toBe("ran");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(response.headers.get("Content-Security-Policy")).toContain(
      `'nonce-${context.nonce}'`,
    );
    expect(response.headers.get("x-nonce")).toBe(context.nonce);
    expect(response.cookies.get("clerk-session")?.value).toBe("preserved");

    const downstreamHeaders = new Headers(
      (runMiddlewarePipeline as jest.Mock).mock.calls[0][1].requestHeaders,
    );
    expect(downstreamHeaders.get("x-nonce")).toBe(context.nonce);
    expect(downstreamHeaders.get("Content-Security-Policy")).toContain(
      `'nonce-${context.nonce}'`,
    );
  });

  it("preserves Clerk redirects, cookies, and security headers", async () => {
    const redirect = NextResponse.redirect(
      new URL("/sign-in?redirect_url=%2Fdashboard", "https://worksphere.test"),
    );
    (runMiddlewarePipeline as jest.Mock).mockImplementationOnce(
      async (_request, context) => context.protect(),
    );
    mockClerkAuth.protect.mockRejectedValueOnce(redirect);

    const response = await middleware(
      new NextRequest("https://worksphere.test/dashboard"),
      {} as never,
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://worksphere.test/sign-in?redirect_url=%2Fdashboard",
    );
    expect(response.cookies.get("clerk-session")?.value).toBe("preserved");
    expect(response.headers.get("Content-Security-Policy")).toContain("nonce-");
  });

  it("preserves mutation request bodies through Clerk and the pipeline", async () => {
    const request = new NextRequest("https://worksphere.test/api/bookings", {
      method: "POST",
      body: JSON.stringify({ venueId: "venue-1" }),
      headers: { "content-type": "application/json" },
    });

    await middleware(request, {} as never);

    const pipelineRequest = (runMiddlewarePipeline as jest.Mock).mock
      .calls[0][0] as NextRequest;
    expect(await pipelineRequest.text()).toBe(
      JSON.stringify({ venueId: "venue-1" }),
    );
    expect(pipelineRequest.headers.get("cookie")).toBe(
      request.headers.get("cookie"),
    );
  });

  it("preserves matcher coverage for static assets, APIs, and Clerk proxy routes", () => {
    expect(config.matcher).toEqual(middlewareMatcher);
    expect(config.matcher).toContain("/(api|trpc)(.*)");
    expect(config.matcher).toContain("/__clerk/:path*");
  });

  it("propagates pipeline failures instead of returning an allowed response", async () => {
    (runMiddlewarePipeline as jest.Mock).mockRejectedValueOnce(
      new Error("pipeline failed"),
    );

    await expect(
      middleware(
        new NextRequest("https://worksphere.test/dashboard"),
        {} as never,
      ),
    ).rejects.toThrow("pipeline failed");
  });
});
