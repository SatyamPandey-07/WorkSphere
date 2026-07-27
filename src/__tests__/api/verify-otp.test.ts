import { NextRequest } from "next/server";
import { POST } from "@/app/api/auth/verify-otp/route";
import { resetRateLimit } from "@/lib/rateLimit";

jest.mock("@/lib/csrf", () => ({
  verifyCsrfToken: jest.fn().mockResolvedValue(true),
  CSRF_COOKIE_NAME: "csrf-token",
  CSRF_HEADER_NAME: "x-csrf-token",
}));

describe("POST /api/auth/verify-otp", () => {
  beforeEach(() => {
    resetRateLimit();
    jest.clearAllMocks();
  });

  function makeRequest(body: unknown, ip?: string) {
    return new NextRequest("http://localhost/api/auth/verify-otp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(ip ? { "x-forwarded-for": ip } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  it("should return 200 on valid request under rate limit", async () => {
    const req = makeRequest({ email: "test@example.com", otp: "123456" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message).toBe("Verification successful.");
  });

  it("should return 400 for invalid email", async () => {
    const req = makeRequest({ email: "not-an-email", otp: "123456" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("should return 400 for non-digit OTP", async () => {
    const req = makeRequest({ email: "test@example.com", otp: "abc" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("should rate limit after 5 attempts per email+IP", async () => {
    const body = { email: "ratelimit@example.com", otp: "123456" };

    for (let i = 0; i < 5; i++) {
      const req = makeRequest(body, "10.0.0.1");
      const res = await POST(req);
      expect(res.status).toBe(200);
    }

    const req = makeRequest(body, "10.0.0.1");
    const res = await POST(req);
    expect(res.status).toBe(429);

    const data = await res.json();
    expect(data.error).toContain("Too many verification attempts");
  });

  it("should track different email+IP combinations separately", async () => {
    const req1 = makeRequest({ email: "user1@example.com", otp: "123456" }, "10.0.0.1");
    expect((await POST(req1)).status).toBe(200);

    const req2 = makeRequest({ email: "user2@example.com", otp: "123456" }, "10.0.0.2");
    expect((await POST(req2)).status).toBe(200);

    for (let i = 0; i < 5; i++) {
      const r = makeRequest({ email: "user1@example.com", otp: "123456" }, "10.0.0.1");
      await POST(r);
    }

    const blocked = makeRequest({ email: "user1@example.com", otp: "123456" }, "10.0.0.1");
    expect((await POST(blocked)).status).toBe(429);

    const allowed = makeRequest({ email: "user2@example.com", otp: "123456" }, "10.0.0.2");
    expect((await POST(allowed)).status).toBe(200);
  });

  it("should return 429 with Retry-After header when rate limited", async () => {
    const body = { email: "retry@example.com", otp: "123456" };

    for (let i = 0; i < 5; i++) {
      await POST(makeRequest(body, "10.0.0.3"));
    }

    const res = await POST(makeRequest(body, "10.0.0.3"));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(res.headers.get("X-RateLimit-Limit")).toBe("5");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
  });
});
