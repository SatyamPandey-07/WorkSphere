/**
 * @jest-environment node
 *
 * Integration tests for the core booking / rating / favorites / webhook flows.
 * They run the real route handlers against a real Postgres database; only the
 * Clerk identity is stubbed. Skipped unless INTEGRATION_DATABASE_URL is set:
 *
 *   INTEGRATION_DATABASE_URL=postgresql://... npx jest src/__tests__/integration
 */
import http from "http";
import type { AddressInfo } from "net";
import { createHmac } from "crypto";

const DB_URL = process.env.INTEGRATION_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;

const describeIfDb = DB_URL ? describe : describe.skip;

// Real I/O (Postgres, PDF font embedding, HTTP) is slower than unit tests.
jest.setTimeout(30_000);

const USER_ID = "it_user_core_flows";
const USER_EMAIL = "it-core-flows@example.com";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(async () => ({ userId: "it_user_core_flows" })),
  currentUser: jest.fn(async () => ({
    id: "it_user_core_flows",
    firstName: "Integration",
    lastName: "Tester",
    imageUrl: null,
    primaryEmailAddress: { emailAddress: "it-core-flows@example.com" },
    emailAddresses: [
      {
        emailAddress: "it-core-flows@example.com",
        verification: { status: "verified" },
      },
    ],
  })),
}));

// Receivers in these tests listen on localhost, which the SSRF guard blocks.
jest.mock("@/lib/ssrfValidation", () => ({
  isSafeWebhookUrl: jest.fn(async () => ({ isSafe: true })),
}));

// Side-effect subscribers (email, chat integrations) are not under test here.
jest.mock("@/core/subscribers/booking", () => ({}));
jest.mock("@/core/subscribers/discord", () => ({}));
jest.mock("@/core/subscribers/whatsapp", () => ({}));
jest.mock("@/core/subscribers/guests", () => ({}));
jest.mock("@/core/subscribers/telegram", () => ({}));
jest.mock("@/lib/agents/MemoryAgent", () => ({
  updateUserPreferencesSummary: jest.fn(async () => undefined),
}));

// jest.setup.js stubs global fetch; webhook delivery needs the real one.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { fetch: realFetch } = require("undici");

function futureDate(daysAhead: number): string {
  return new Date(Date.now() + daysAhead * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function jsonRequest(url: string, method: string, body?: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { NextRequest } = require("next/server");
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describeIfDb("core flows (real database)", () => {
  // Loaded lazily so DATABASE_URL is set before the Prisma client is created.
  let prisma: any;
  let venueId: string;

  beforeAll(async () => {
    global.fetch = realFetch as any;
    prisma = (await import("@/lib/prisma")).prisma;

    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.venue.deleteMany({
      where: { placeId: { startsWith: "it-core-" } },
    });

    await prisma.user.create({
      data: {
        id: USER_ID,
        email: USER_EMAIL,
        firstName: "Integration",
        timezone: "Asia/Kolkata",
      },
    });
    const venue = await prisma.venue.create({
      data: {
        placeId: "it-core-venue-1",
        name: "Integration Test Cafe",
        latitude: 40.71,
        longitude: -74.0,
        category: "cafe",
        address: "1 Test Street",
      },
    });
    venueId = venue.id;
  });

  beforeEach(async () => {
    (await import("@/lib/rateLimit")).resetRateLimit();
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.venue.deleteMany({
      where: { placeId: { startsWith: "it-core-" } },
    });
    await prisma.$disconnect();
  });

  describe("ratings", () => {
    it("rates an existing venue by id without renaming or duplicating it", async () => {
      const { POST } = await import("@/app/api/venues/[venueId]/rate/route");
      const before = await prisma.venue.count();

      const res = await POST(
        jsonRequest(`http://localhost/api/venues/${venueId}/rate`, "POST", {
          wifiQuality: 4,
          hasOutlets: true,
          noiseLevel: "quiet",
          comment: "Great for focus work",
        }),
        { params: Promise.resolve({ venueId }) },
      );

      expect(res.status).toBe(201);
      const venue = await prisma.venue.findUnique({ where: { id: venueId } });
      expect(venue.name).toBe("Integration Test Cafe");
      expect(venue.address).toBe("1 Test Street");
      expect(venue.category).toBe("cafe");
      expect(await prisma.venue.count()).toBe(before);

      const rating = await prisma.venueRating.findUnique({
        where: { userId_venueId: { userId: USER_ID, venueId } },
      });
      expect(rating).toMatchObject({ wifiQuality: 4, noiseLevel: "quiet" });
    });

    it("returns 404 for an unknown venue instead of inventing one at (0,0)", async () => {
      const { POST } = await import("@/app/api/venues/[venueId]/rate/route");
      const res = await POST(
        jsonRequest(
          "http://localhost/api/venues/it-core-missing/rate",
          "POST",
          {
            wifiQuality: 3,
            hasOutlets: false,
            noiseLevel: "moderate",
          },
        ),
        { params: Promise.resolve({ venueId: "it-core-missing" }) },
      );
      expect(res.status).toBe(404);
      expect(
        await prisma.venue.findUnique({
          where: { placeId: "it-core-missing" },
        }),
      ).toBeNull();
    });
  });

  describe("favorites", () => {
    it("adds and removes a favorite by venue id", async () => {
      const route = await import("@/app/api/favorites/route");

      const add = await route.POST(
        jsonRequest("http://localhost/api/favorites", "POST", { venueId }),
      );
      expect(add.status).toBe(201);
      expect(
        await prisma.favorite.count({ where: { userId: USER_ID, venueId } }),
      ).toBe(1);

      const remove = await route.DELETE(
        jsonRequest(
          `http://localhost/api/favorites?venueId=${venueId}`,
          "DELETE",
        ),
      );
      expect(remove.status).toBe(200);
      expect(
        await prisma.favorite.count({ where: { userId: USER_ID, venueId } }),
      ).toBe(0);
    });
  });

  describe("bookings", () => {
    it("books recurring dates with unique confirmations and the booker's timezone", async () => {
      const { POST } = await import("@/app/api/bookings/confirm/route");
      const dates = [futureDate(5), futureDate(12)];

      const res = await POST(
        jsonRequest("http://localhost/api/bookings/confirm", "POST", {
          venue: { id: venueId },
          dates,
          time: "09:30",
          timeZone: "Asia/Kolkata",
        }),
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.confirmationIds).toHaveLength(2);

      const rows = await prisma.booking.findMany({
        where: { userId: USER_ID, date: { in: dates } },
      });
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((r: any) => r.confirmationId)).size).toBe(2);
      expect(rows.every((r: any) => r.timeZone === "Asia/Kolkata")).toBe(true);
      expect(rows.every((r: any) => r.customerEmail === USER_EMAIL)).toBe(true);

      const dup = await POST(
        jsonRequest("http://localhost/api/bookings/confirm", "POST", {
          venue: { id: venueId },
          dates: [dates[0]],
          time: "09:30",
          timeZone: "Asia/Kolkata",
        }),
      );
      expect(dup.status).toBe(409);
    });

    it("cancels a future booking and refuses one inside the 2-hour window", async () => {
      const { DELETE } = await import("@/app/api/bookings/[bookingId]/route");
      const { parseBookingDateTime } = await import("@/lib/bookingTime");

      const far = await prisma.booking.create({
        data: {
          userId: USER_ID,
          venueId,
          date: futureDate(20),
          time: "10:00",
          timeZone: "UTC",
          customerEmail: USER_EMAIL,
          confirmationId: `IT-${Date.now()}-A`,
        },
      });
      const farRes = await DELETE(new Request("http://localhost"), {
        params: Promise.resolve({ bookingId: far.id }),
      });
      expect(farRes.status).toBe(200);
      expect(
        (await prisma.booking.findUnique({ where: { id: far.id } })).status,
      ).toBe("CANCELLED");

      // Starts in one hour, expressed in the booker's own timezone.
      const soon = new Date(Date.now() + 60 * 60 * 1000);
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(soon);
      const get = (t: string) => parts.find((p) => p.type === t)!.value;
      const date = `${get("year")}-${get("month")}-${get("day")}`;
      const time = `${get("hour")}:${get("minute")}`;
      expect(
        Math.abs(
          parseBookingDateTime(date, time, "Asia/Kolkata")!.getTime() -
            soon.getTime(),
        ),
      ).toBeLessThan(60_000);

      const near = await prisma.booking.create({
        data: {
          userId: USER_ID,
          venueId,
          date,
          time,
          timeZone: "Asia/Kolkata",
          customerEmail: USER_EMAIL,
          confirmationId: `IT-${Date.now()}-B`,
        },
      });
      const nearRes = await DELETE(new Request("http://localhost"), {
        params: Promise.resolve({ bookingId: near.id }),
      });
      expect(nearRes.status).toBe(400);
      expect((await nearRes.json()).code).toBe("INSIDE_WINDOW");
    });

    it("serves a PDF receipt only to the booking owner", async () => {
      const { GET } =
        await import("@/app/api/bookings/[bookingId]/download/route");
      const booking = await prisma.booking.findFirst({
        where: { userId: USER_ID },
      });

      const res = await GET(jsonRequest("http://localhost", "GET"), {
        params: Promise.resolve({ bookingId: booking.id }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/pdf");
      const bytes = Buffer.from(await res.arrayBuffer());
      expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");

      const other = await prisma.booking.create({
        data: {
          user: {
            create: { id: `${USER_ID}_other`, email: "it-other@example.com" },
          },
          venue: { connect: { id: venueId } },
          date: futureDate(3),
          time: "11:00",
          customerEmail: "it-other@example.com",
          confirmationId: `IT-${Date.now()}-C`,
        },
      });
      try {
        const forbidden = await GET(jsonRequest("http://localhost", "GET"), {
          params: Promise.resolve({ bookingId: other.id }),
        });
        expect(forbidden.status).toBe(404);
      } finally {
        await prisma.user.delete({ where: { id: `${USER_ID}_other` } });
      }
    });
  });

  describe("AI search (no LLM key)", () => {
    it("returns real WorkSphere + OpenStreetMap venues and a readable reply", async () => {
      const savedKey = process.env.GROQ_API_KEY;
      delete process.env.GROQ_API_KEY;
      try {
        const { POST } = await import("@/app/api/chat/route");
        const res = await POST(
          new Request("http://localhost/api/chat", {
            method: "POST",
            body: JSON.stringify({
              messages: [
                { role: "user", content: "quiet cafe with wifi near me" },
              ],
              // Next to the "Integration Test Cafe" created in beforeAll.
              location: { lat: 40.7101, lng: -74.0 },
            }),
          }),
        );
        expect(res.status).toBe(200);

        const raw = await res.text();
        const metaLine = raw.split("\n\n")[0];
        expect(metaLine.startsWith("METADATA:")).toBe(true);
        const meta = JSON.parse(metaLine.slice("METADATA:".length));
        const text = raw.split("TEXT:").slice(1).join("");

        expect(meta.venues.length).toBeGreaterThan(0);
        expect(meta.venues.some((v: any) => v.id === venueId)).toBe(true);
        expect(
          meta.venues.every((v: any) => !String(v.id).startsWith("mock-")),
        ).toBe(true);
        expect(
          meta.venues.every((v: any) => v.score >= 0 && v.score <= 10),
        ).toBe(true);
        expect(meta.mapUpdates.markers.length).toBeGreaterThan(0);
        expect(text).toContain("**");

        console.log(
          `AI search returned ${meta.venues.length} venues (${meta.agentSteps.find((s: any) => s.agent === "Data")?.result?.meta?.source}); top: ${meta.venues
            .slice(0, 3)
            .map((v: any) => `${v.name} ${v.score}`)
            .join(", ")}`,
        );
      } finally {
        if (savedKey) process.env.GROQ_API_KEY = savedKey;
      }
    });
  });

  describe("seat reservations", () => {
    it("lets exactly one of several concurrent requests reserve the same seat", async () => {
      const { POST } = await import("@/app/api/reservations/book/route");
      const { resetRateLimit } = await import("@/lib/rateLimit");
      const seat = await prisma.venueSeat.create({
        data: { venueId, seatNumber: `IT-${Date.now()}`, x: 0, y: 0 },
      });
      const date = futureDate(8);

      const attempt = () => {
        resetRateLimit();
        return POST(
          jsonRequest("http://localhost/api/reservations/book", "POST", {
            venueId,
            seatId: seat.id,
            date,
            time: "13:00",
            duration: 60,
            timeZone: "UTC",
          }),
        );
      };
      const responses = await Promise.all([
        attempt(),
        attempt(),
        attempt(),
        attempt(),
      ]);
      const statuses = responses.map((r) => r.status).sort();

      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(3);
      expect(
        await prisma.booking.count({
          where: { seatId: seat.id, date, status: "CONFIRMED" },
        }),
      ).toBe(1);
    });
  });

  describe("check-ins", () => {
    it("checks in, counts toward occupancy, advances the streak, and checks out", async () => {
      const route = await import("@/app/api/venues/[venueId]/check-in/route");
      const ctx = { params: Promise.resolve({ venueId }) };

      const res = await route.POST(new Request("http://localhost"), ctx);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.streak.currentStreak).toBeGreaterThanOrEqual(1);

      const status = await (
        await route.GET(new Request("http://localhost"), ctx)
      ).json();
      expect(status).toMatchObject({ activeCount: 1, checkedIn: true });

      // Same-day repeat check-in must not double-count the streak.
      const again = await (
        await route.POST(new Request("http://localhost"), ctx)
      ).json();
      expect(again.streak.incremented).toBe(false);
      expect(again.streak.currentStreak).toBe(data.streak.currentStreak);

      await route.DELETE(new Request("http://localhost"), ctx);
      const after = await (
        await route.GET(new Request("http://localhost"), ctx)
      ).json();
      expect(after).toMatchObject({ activeCount: 0, checkedIn: false });
    });
  });

  describe("webhooks", () => {
    it("delivers signed events that verify with the endpoint secret", async () => {
      const received: { headers: http.IncomingHttpHeaders; body: string }[] =
        [];
      const server = http.createServer((req, res) => {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          received.push({ headers: req.headers, body });
          res.writeHead(204).end();
        });
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      const { port } = server.address() as AddressInfo;

      const secret =
        "whsec_" +
        Buffer.from("integration-test-secret-key").toString("base64");
      const endpoint = await prisma.webhookEndpoint.create({
        data: {
          userId: USER_ID,
          url: `http://127.0.0.1:${port}/hook`,
          secret,
          eventTypes: ["BOOKING_CONFIRMED"],
          headers: { "X-Receiver-Token": "abc123" },
        },
      });

      try {
        const { deliverWebhookEvent } = await import("@/lib/webhooks/deliver");
        const results = await deliverWebhookEvent(
          USER_ID,
          "BOOKING_CONFIRMED",
          {
            bookingId: "b_1",
          },
        );

        expect(results).toEqual([
          { endpointId: endpoint.id, status: "SUCCESS", statusCode: 204 },
        ]);
        expect(received).toHaveLength(1);
        const { headers, body } = received[0];
        expect(headers["x-receiver-token"]).toBe("abc123");

        const expected = createHmac(
          "sha256",
          Buffer.from(secret.replace(/^whsec_/, ""), "base64"),
        )
          .update(
            `${headers["webhook-id"]}.${headers["webhook-timestamp"]}.${body}`,
          )
          .digest("base64");
        expect(headers["webhook-signature"]).toBe(`v1,${expected}`);
        expect(JSON.parse(body)).toMatchObject({
          type: "BOOKING_CONFIRMED",
          data: { bookingId: "b_1" },
        });

        const log = await prisma.webhookDeliveryLog.findFirst({
          where: { endpointId: endpoint.id },
        });
        expect(log).toMatchObject({ status: "SUCCESS", statusCode: 204 });
      } finally {
        server.close();
        await prisma.webhookEndpoint.delete({ where: { id: endpoint.id } });
      }
    });
  });
});
