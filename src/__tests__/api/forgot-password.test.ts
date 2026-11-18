import { NextRequest } from "next/server";
import { POST } from "@/app/api/auth/forgot-password/route";
import { rateLimit } from "@/lib/rateLimit";

jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn().mockResolvedValue(true),
  getRateLimitInfo: jest.fn().mockResolvedValue(null),
}));

describe("POST /api/auth/forgot-password", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function makeRequest(body: unknown, ip?: string) {
    return new NextRequest("http://localhost/api/auth/forgot-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(ip ? { "x-forwarded-for": ip } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  it("should return 200 on valid request under rate limit with generic response", async () => {
    const req = makeRequest({ email: "test@example.com" });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.message).toContain("If an account with that email exists");
    expect(json.recoveryStrategy).toBe("reset_password_email_code");
  });

  it("should return 400 for invalid email format", async () => {
    const req = makeRequest({ email: "not-an-email" });
    const res = await POST(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe("A valid email address is required.");
  });

  it("should return 400 for missing email", async () => {
    const req = makeRequest({});
    const res = await POST(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe("A valid email address is required.");
  });

  it("should return 429 when rate limit is exceeded", async () => {
    (rateLimit as jest.Mock).mockResolvedValueOnce(false);

    const req = makeRequest({ email: "rate-limited@example.com" });
    const res = await POST(req);
    expect(res.status).toBe(429);

    const json = await res.json();
    expect(json.error).toContain("Too many password reset requests");
  });

  it("should handle malformed JSON bodies gracefully", async () => {
    const req = new NextRequest("http://localhost/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "invalid-json{",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe("Invalid JSON body.");
  });
});
