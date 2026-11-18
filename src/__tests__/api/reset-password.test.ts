import { NextRequest } from "next/server";
import { POST } from "@/app/api/auth/reset-password/route";
import { rateLimit } from "@/lib/rateLimit";

jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn().mockResolvedValue(true),
  getRateLimitInfo: jest.fn().mockResolvedValue(null),
}));

describe("POST /api/auth/reset-password", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function makeRequest(body: unknown, ip?: string) {
    return new NextRequest("http://localhost/api/auth/reset-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(ip ? { "x-forwarded-for": ip } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  it("should return 200 with guidance pointing to Clerk native frontend recovery", async () => {
    const req = makeRequest({
      code: "123456",
      newPassword: "StrongPassword123!",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.authProvider).toBe("clerk");
    expect(json.message).toContain("Please complete password reset on the frontend");
  });

  it("should return 400 for missing code", async () => {
    const req = makeRequest({
      newPassword: "StrongPassword123!",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe("Verification code is required.");
  });

  it("should return 400 for weak password", async () => {
    const req = makeRequest({
      code: "123456",
      newPassword: "weak",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe("Password must be at least 8 characters long.");
  });

  it("should return 429 when rate limit is exceeded", async () => {
    (rateLimit as jest.Mock).mockResolvedValueOnce(false);

    const req = makeRequest({
      code: "123456",
      newPassword: "StrongPassword123!",
    });

    const res = await POST(req);
    expect(res.status).toBe(429);

    const json = await res.json();
    expect(json.error).toContain("Too many password reset attempts");
  });

  it("should handle malformed JSON bodies gracefully", async () => {
    const req = new NextRequest("http://localhost/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "malformed{",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe("Invalid JSON body.");
  });
});
