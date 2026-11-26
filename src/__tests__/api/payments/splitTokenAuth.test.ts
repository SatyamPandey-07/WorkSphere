import { GET, POST } from "@/app/api/payments/split/[token]/route";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { rateLimit } from "@/lib/rateLimit";
import { generateSplitPaymentToken } from "@/lib/billing/splitPayment";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn().mockResolvedValue(true),
}));

jest.mock("@/core/events", () => ({
  eventBus: { emit: jest.fn() },
}));

jest.mock("@/lib/prisma", () => {
  const client: any = {
    booking: { findUnique: jest.fn() },
    bookingGuest: { findUnique: jest.fn(), updateMany: jest.fn() },
  };
  client.$transaction = jest.fn(async (cb: (tx: any) => Promise<unknown>) =>
    cb(client),
  );
  return { prisma: client };
});

const db = prisma as any;
const mockAuth = auth as unknown as jest.Mock;
const mockRateLimit = rateLimit as jest.Mock;

describe("Split-Payment API Authentication & Bearer Capability Alignment (Issue #10071)", () => {
  const validPayload = {
    bookingId: "booking-abc",
    guestId: "guest-xyz",
    email: "guest@example.com",
    name: "Alex Guest",
    amount: 25.0,
    currency: "USD",
    venueName: "Creative Workspace",
    date: "2026-12-15",
    time: "11:00",
  };

  const mockBookingRecord = {
    id: "booking-abc",
    date: "2026-12-15",
    time: "11:00",
    status: "CONFIRMED",
    duration: 60,
    seatNumber: "A12",
    venue: {
      name: "Creative Workspace",
      address: "123 Main St",
      category: "coworking_space",
      imageUrl: "https://example.com/venue.jpg",
      wifiSpeed: 200,
    },
    user: {
      firstName: "Host",
      lastName: "Owner",
    },
    guests: [
      {
        id: "guest-xyz",
        bookingId: "booking-abc",
        email: "guest@example.com",
        name: "Alex Guest",
        status: "ACCEPTED",
        paidAt: null,
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRateLimit.mockResolvedValue(true);
    db.booking.findUnique.mockResolvedValue(mockBookingRecord);
    db.bookingGuest.findUnique.mockResolvedValue({
      id: "guest-xyz",
      bookingId: "booking-abc",
      status: "ACCEPTED",
      paidAt: null,
      booking: {
        status: "CONFIRMED",
        date: "2026-12-15",
        time: "11:00",
        venue: { name: "Creative Workspace" },
      },
    });
    db.bookingGuest.updateMany.mockResolvedValue({ count: 1 });
  });

  describe("Unauthenticated Guest Access (Bearer Token Capability)", () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue({ userId: null });
    });

    it("should allow an unauthenticated guest with a valid bearer token to retrieve checkout details via GET", async () => {
      const token = generateSplitPaymentToken(validPayload);
      const req = new NextRequest(
        `http://localhost:3000/api/payments/split/${token}`,
      );
      const res = await GET(req, { params: Promise.resolve({ token }) });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.valid).toBe(true);
      expect(json.payload.guestId).toBe("guest-xyz");
      expect(json.venue.name).toBe("Creative Workspace");
    });

    it("should allow an unauthenticated guest with a valid bearer token to complete payment via POST", async () => {
      const token = generateSplitPaymentToken(validPayload);
      const req = new NextRequest(
        `http://localhost:3000/api/payments/split/${token}`,
        { method: "POST" },
      );
      const res = await POST(req, { params: Promise.resolve({ token }) });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.guestPass).toBeDefined();
      expect(json.guestPass.amountPaid).toBe(25.0);
      expect(db.bookingGuest.updateMany).toHaveBeenCalled();
    });
  });

  describe("Authenticated User Access (Dual-Mode Session)", () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue({ userId: "clerk-user-123" });
    });

    it("should allow an authenticated user with a valid bearer token to access GET", async () => {
      const token = generateSplitPaymentToken(validPayload);
      const req = new NextRequest(
        `http://localhost:3000/api/payments/split/${token}`,
      );
      const res = await GET(req, { params: Promise.resolve({ token }) });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.valid).toBe(true);
    });

    it("should allow an authenticated user with a valid bearer token to complete payment via POST", async () => {
      const token = generateSplitPaymentToken(validPayload);
      const req = new NextRequest(
        `http://localhost:3000/api/payments/split/${token}`,
        { method: "POST" },
      );
      const res = await POST(req, { params: Promise.resolve({ token }) });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });
  });

  describe("Token Validation & Security Enforcement", () => {
    it("should return HTTP 400 for a tampered or invalid token signature", async () => {
      const validToken = generateSplitPaymentToken(validPayload);
      const [payloadPart] = validToken.split(".");
      const forgedToken = `${payloadPart}.invalidSignatureHere`;

      const req = new NextRequest(
        `http://localhost:3000/api/payments/split/${forgedToken}`,
      );
      const res = await GET(req, {
        params: Promise.resolve({ token: forgedToken }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Invalid or expired payment link");
    });

    it("should return HTTP 400 for an expired token", async () => {
      const expiredToken = generateSplitPaymentToken({
        ...validPayload,
        expiresInHours: -1, // Expired 1 hour ago
      });

      const req = new NextRequest(
        `http://localhost:3000/api/payments/split/${expiredToken}`,
      );
      const res = await GET(req, {
        params: Promise.resolve({ token: expiredToken }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Invalid or expired payment link");
    });

    it("should return HTTP 429 when IP rate limit is exceeded", async () => {
      mockRateLimit.mockResolvedValueOnce(false); // Simulate rate limit triggered

      const token = generateSplitPaymentToken(validPayload);
      const req = new NextRequest(
        `http://localhost:3000/api/payments/split/${token}`,
        {
          headers: { "x-forwarded-for": "203.0.113.195" },
        },
      );
      const res = await GET(req, { params: Promise.resolve({ token }) });

      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.error).toContain("Too many requests");
    });
  });
});
