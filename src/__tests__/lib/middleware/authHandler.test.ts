import { NextRequest, NextResponse } from "next/server";
import { authMiddleware } from "@/lib/middleware/handlers/authHandler";
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

function request(path: string) {
  return new NextRequest(`https://worksphere.test${path}`);
}

describe("authMiddleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("allows manifest public routes without invoking Clerk protection", async () => {
    const protect = jest.fn();
    const response = await authMiddleware(
      request("/venues"),
      { protect } as MiddlewareContext,
      next,
    );

    expect(response.status).toBe(200);
    expect(protect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("requires Clerk protection on protected routes and stores its verified identity", async () => {
    const context: MiddlewareContext = {
      protect: jest.fn().mockResolvedValue({
        userId: "user-1",
        sessionClaims: { metadata: { role: "member" } },
      }),
    };

    const response = await authMiddleware(request("/dashboard"), context, next);

    expect(response.status).toBe(200);
    expect(context.protect).toHaveBeenCalledTimes(1);
    expect(context.userId).toBe("user-1");
    expect(context.sessionClaims).toEqual({ metadata: { role: "member" } });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("does not continue when Clerk rejects a protected request", async () => {
    const clerkRedirect = new Error("Clerk sign-in redirect");
    const context: MiddlewareContext = {
      protect: jest.fn().mockRejectedValue(clerkRedirect),
    };

    await expect(
      authMiddleware(request("/dashboard"), context, next),
    ).rejects.toBe(clerkRedirect);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects an empty Clerk auth result instead of treating it as authorization", async () => {
    const context: MiddlewareContext = {
      protect: jest.fn().mockResolvedValue(undefined),
    };

    const response = await authMiddleware(request("/dashboard"), context, next);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });

  it("fails closed when the Clerk protect function is not configured", async () => {
    const response = await authMiddleware(
      request("/dashboard"),
      {},
      next,
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Authentication middleware unavailable",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("preserves role-based admin authorization", async () => {
    const context: MiddlewareContext = {
      protect: jest.fn().mockResolvedValue({
        userId: "user-1",
        sessionClaims: { metadata: { role: "member" } },
      }),
    };

    const denied = await authMiddleware(
      request("/api/admin/metrics"),
      context,
      next,
    );
    expect(denied.status).toBe(403);
    expect(next).not.toHaveBeenCalled();

    context.protect = jest.fn().mockResolvedValue({
      userId: "admin-1",
      sessionClaims: { metadata: { role: "admin" } },
    });
    const allowed = await authMiddleware(
      request("/api/admin/metrics"),
      context,
      next,
    );
    expect(allowed.status).toBe(200);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
