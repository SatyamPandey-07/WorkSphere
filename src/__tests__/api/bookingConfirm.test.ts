import { NextRequest } from "next/server";
import { POST } from "@/app/api/bookings/confirm/route";
import { resetRateLimit } from "@/lib/rateLimit";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    venue: {
      upsert: jest.fn().mockResolvedValue({ id: "venue-1", name: "Test Venue" }),
    },
    booking: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: "booking-1" }),
    },
    $transaction: jest.fn().mockImplementation(async (cb: any) => {
      const tx = {
        venue: {
          upsert: jest.fn().mockResolvedValue({ id: "venue-1", name: "Test Venue" }),
        },
        booking: {
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn().mockResolvedValue({ id: "booking-1" }),
        },
      };
      return cb(tx);
    }),
  },
}));

jest.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "test-user" }),
}));

jest.mock("@/lib/auth", () => ({
  ensureUserExists: () => Promise.resolve(),
}));

jest.mock("@/core/events", () => ({
  eventBus: { emit: jest.fn() },
}));

jest.mock("@/core/subscribers/booking", () => {});
jest.mock("@/core/subscribers/discord", () => {});
jest.mock("@/core/subscribers/whatsapp", () => {});
jest.mock("@/core/subscribers/guests", () => {});
jest.mock("@/core/subscribers/telegram", () => {});

describe("POST /api/bookings/confirm - Rate Limit 429 Response", () => {
  beforeEach(() => {
    resetRateLimit();
  });

  it("returns 429 with retryAfterSeconds in JSON body after exceeding rate limit", async () => {
    const body = JSON.stringify({
      venue: { id: "venue-1", name: "Test", category: "cafe" },
      dates: ["2026-08-01"],
      time: "10:00",
    });

    // Exhaust the 5 req/min rate limit
    for (let i = 0; i < 5; i++) {
      const req = new NextRequest("http://localhost/api/bookings/confirm", {
        method: "POST",
        body,
        headers: { "Content-Type": "application/json" },
      });
      await POST(req);
    }

    // 6th request should be rate limited
    const req = new NextRequest("http://localhost/api/bookings/confirm", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);

    expect(res.status).toBe(429);

    const data = await res.json();
    expect(data.error).toContain("Rate limit exceeded");
    expect(data).toHaveProperty("retryAfterSeconds");
    expect(typeof data.retryAfterSeconds).toBe("number");
    expect(data.retryAfterSeconds).toBeGreaterThan(0);
    expect(data.retryAfterSeconds).toBeLessThanOrEqual(60);

    // Verify headers
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(res.headers.get("X-RateLimit-Reset")).toBeTruthy();
  });

  it("returns 200 for requests within rate limit", async () => {
    const body = JSON.stringify({
      venue: { id: "venue-2", name: "Test 2", category: "cafe" },
      dates: ["2026-08-02"],
      time: "11:00",
    });

    const req = new NextRequest("http://localhost/api/bookings/confirm", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.confirmationId).toBeTruthy();
  });
});
