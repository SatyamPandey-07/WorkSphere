import { NextRequest } from "next/server";
import { POST } from "@/app/api/bookings/confirm/route";
import { resetRateLimit } from "@/lib/rateLimit";

const createdBookings: any[] = [];
const existingBookings: any[] = [];

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.id === "venue-1" || where.placeId === "venue-1"
          ? {
              id: "venue-1",
              name: "Test Venue",
              category: "cafe",
              address: "1 Main St",
            }
          : null,
      ),
      create: jest.fn(async ({ data }: any) => ({ id: "venue-new", ...data })),
    },
    $transaction: jest.fn(async (cb: any) =>
      cb({
        booking: {
          findMany: jest.fn(async ({ where }: any) =>
            existingBookings.filter(
              (b) =>
                b.userId === where.userId &&
                where.date.in.includes(b.date) &&
                b.time === where.time,
            ),
          ),
          create: jest.fn(async ({ data }: any) => {
            const booking = {
              id: `booking-${createdBookings.length + 1}`,
              ...data,
            };
            createdBookings.push(booking);
            return booking;
          }),
        },
      }),
    ),
  },
}));

jest.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "test-user" }),
  currentUser: () =>
    Promise.resolve({
      primaryEmailAddress: { emailAddress: "owner@example.com" },
    }),
}));

jest.mock("@/lib/auth", () => ({
  ensureUserExists: () => Promise.resolve(),
}));

jest.mock("@/core/events", () => ({
  eventBus: { emit: jest.fn() },
}));

jest.mock("@/lib/webhooks/deliver", () => ({
  emitWebhookEvent: jest.fn(),
}));

jest.mock("@/core/subscribers/booking", () => {});
jest.mock("@/core/subscribers/discord", () => {});
jest.mock("@/core/subscribers/whatsapp", () => {});
jest.mock("@/core/subscribers/guests", () => {});
jest.mock("@/core/subscribers/telegram", () => {});

function futureDate(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function request(body: unknown) {
  return new NextRequest("http://localhost/api/bookings/confirm", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const baseBody = () => ({
  venue: { id: "venue-1", name: "Test Venue", category: "cafe" },
  dates: [futureDate(3)],
  time: "10:00",
  timeZone: "UTC",
  customerEmail: "guest@example.com",
});

describe("POST /api/bookings/confirm", () => {
  beforeEach(() => {
    resetRateLimit();
    createdBookings.length = 0;
    existingBookings.length = 0;
  });

  it("returns 429 with retry metadata after exceeding the rate limit", async () => {
    for (let i = 0; i < 5; i++) {
      await POST(request({ ...baseBody(), dates: [futureDate(10 + i)] }));
    }
    const res = await POST(request(baseBody()));

    expect(res.status).toBe(429);
    const data = await res.json();
    expect(data.error).toContain("Rate limit exceeded");
    expect(data.retryAfterSeconds).toBeGreaterThan(0);
    expect(data.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(res.headers.get("X-RateLimit-Reset")).toBeTruthy();
  });

  it("confirms a single booking", async () => {
    const res = await POST(request(baseBody()));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.confirmationId).toMatch(/^WS-[0-9A-F]{8}$/);
    expect(createdBookings[0]).toMatchObject({
      userId: "test-user",
      venueId: "venue-1",
      time: "10:00",
      timeZone: "UTC",
      customerEmail: "guest@example.com",
    });
  });

  it("gives every date of a recurring booking its own confirmation id", async () => {
    const dates = [futureDate(2), futureDate(9), futureDate(16)];
    const res = await POST(request({ ...baseBody(), dates }));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.confirmationIds).toHaveLength(3);
    expect(new Set(data.confirmationIds).size).toBe(3);
    const groupIds = new Set(createdBookings.map((b) => b.recurringGroupId));
    expect(groupIds.size).toBe(1);
    expect([...groupIds][0]).toBeTruthy();
  });

  it("falls back to the account email, never a hard-coded address", async () => {
    const res = await POST(request({ ...baseBody(), customerEmail: "" }));
    expect(res.status).toBe(200);
    expect(createdBookings[0].customerEmail).toBe("owner@example.com");
  });

  it("rejects dates in the past", async () => {
    const res = await POST(request({ ...baseBody(), dates: ["2020-01-01"] }));
    expect(res.status).toBe(400);
    expect(createdBookings).toHaveLength(0);
  });

  it("rejects malformed times", async () => {
    const res = await POST(request({ ...baseBody(), time: "25:99" }));
    expect(res.status).toBe(400);
  });

  it("returns 409 when the user already booked that slot", async () => {
    const date = futureDate(4);
    existingBookings.push({ userId: "test-user", date, time: "10:00" });
    const res = await POST(request({ ...baseBody(), dates: [date] }));
    expect(res.status).toBe(409);
    expect(createdBookings).toHaveLength(0);
  });

  it("refuses to invent a venue without coordinates", async () => {
    const res = await POST(
      request({ ...baseBody(), venue: { id: "osm-999", name: "Unknown" } }),
    );
    expect(res.status).toBe(400);
  });

  it("creates a new venue from search results that include coordinates", async () => {
    const res = await POST(
      request({
        ...baseBody(),
        venue: {
          id: "osm-42",
          name: "New Cafe",
          category: "cafe",
          lat: 40.7,
          lng: -73.9,
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(createdBookings[0].venueId).toBe("venue-new");
  });
});
