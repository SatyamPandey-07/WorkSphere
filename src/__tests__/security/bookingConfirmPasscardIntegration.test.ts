import { NextRequest } from "next/server";
import { POST } from "@/app/api/bookings/confirm/route";
import { resetRateLimit } from "@/lib/rateLimit";
import {
  clearSigningKeyCache,
  PRIVATE_JWK_ENV,
} from "@/lib/security/serverOfflinePasscardIssuer";
import {
  importVerificationKey,
  verifyOfflinePasscard,
} from "@/lib/security/offlineQrSigner";

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
      id: "test-user",
      primaryEmailAddress: { emailAddress: "owner@example.com" },
    }),
}));

jest.mock("@/lib/auth", () => ({
  ensureUserExists: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/core/events", () => ({
  eventBus: { emit: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock("@/lib/webhooks/deliver", () => ({
  emitWebhookEvent: jest.fn(),
}));

jest.mock("@/core/subscribers/booking", () => {});
jest.mock("@/core/subscribers/discord", () => {});
jest.mock("@/core/subscribers/whatsapp", () => {});
jest.mock("@/core/subscribers/guests", () => {});
jest.mock("@/core/subscribers/telegram", () => {});

const TEST_KEY_PRIVATE = {
  kty: "EC",
  crv: "P-256",
  x: "IwWS2R4U7Cy2eRCIXQI48oi6anob6NKcLR6dIuBomeE",
  y: "BigMwQiCn-va5Vir-gCK-KZJ_sj-6yZtcYzn8mhNFJk",
  d: "OWvPLPNEV7FibA5_g9P7E7YB21xEwT57jQdhnVhdiqQ",
};

const TEST_KEY_PUBLIC = {
  kty: "EC",
  crv: "P-256",
  x: "IwWS2R4U7Cy2eRCIXQI48oi6anob6NKcLR6dIuBomeE",
  y: "BigMwQiCn-va5Vir-gCK-KZJ_sj-6yZtcYzn8mhNFJk",
};

function futureDate(daysAhead: number = 7): string {
  const d = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function request(body: any): NextRequest {
  return new NextRequest("http://localhost/api/bookings/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const baseBody = () => ({
  venue: { id: "venue-1", name: "Test Venue", category: "cafe" },
  date: futureDate(5),
  time: "10:00",
  timeZone: "UTC",
  customerEmail: "guest@example.com",
});

describe("POST /api/bookings/confirm offline passcard issuance (#7820)", () => {
  const originalEnv = process.env[PRIVATE_JWK_ENV];

  beforeEach(() => {
    resetRateLimit();
    clearSigningKeyCache();
    createdBookings.length = 0;
    existingBookings.length = 0;
    process.env[PRIVATE_JWK_ENV] = JSON.stringify(TEST_KEY_PRIVATE);
  });

  afterEach(() => {
    clearSigningKeyCache();
    if (originalEnv !== undefined) {
      process.env[PRIVATE_JWK_ENV] = originalEnv;
    } else {
      delete process.env[PRIVATE_JWK_ENV];
    }
  });

  it("issues a valid offline passcard on successful single booking", async () => {
    const res = await POST(request(baseBody()));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.offlinePasscard).toBeDefined();
    expect(typeof json.offlinePasscard).toBe("string");

    // Verify token with public verification key
    const pubKey = await importVerificationKey(TEST_KEY_PUBLIC);
    const verification = await verifyOfflinePasscard(json.offlinePasscard, pubKey, {
      enforceWindow: false,
    });

    expect(verification.valid).toBe(true);
    if (verification.valid) {
      expect(verification.payload.bookingId).toBe(createdBookings[0].id);
      expect(verification.payload.userId).toBe("test-user");
      expect(verification.payload.venueId).toBe("venue-1");
      expect(verification.payload.seatNumber).toBe("UNASSIGNED");
    }
  });

  it("issues passcards for each date in a recurring multi-booking", async () => {
    const dates = [futureDate(2), futureDate(9)];
    const res = await POST(request({ ...baseBody(), dates }));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.offlinePasscard).toBeDefined(); // First passcard
    expect(json.offlinePasscards).toHaveLength(2);
    expect(typeof json.offlinePasscards[0]).toBe("string");
    expect(typeof json.offlinePasscards[1]).toBe("string");
  });

  it("gracefully omits offline passcard when signing key is missing, without failing the booking", async () => {
    delete process.env[PRIVATE_JWK_ENV];
    clearSigningKeyCache();

    const res = await POST(request(baseBody()));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.bookingId).toBeDefined();
    expect(json.offlinePasscard).toBeUndefined();
    expect(json.offlinePasscardError).toBe("Signing unavailable");
  });

  it("gracefully handles corrupted signing key without breaking confirmed booking", async () => {
    process.env[PRIVATE_JWK_ENV] = "{ not-valid-jwk";
    clearSigningKeyCache();

    const res = await POST(request(baseBody()));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.offlinePasscard).toBeUndefined();
    expect(json.offlinePasscardError).toBe("Signing unavailable");
  });
});
