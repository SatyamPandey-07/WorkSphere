import { calculateSplitBill } from "@/lib/billing/splitPayment";
import { POST } from "@/app/api/bookings/[bookingId]/split-bill/route";
import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    booking: {
      findUnique: jest.fn(),
    },
  },
}));

describe("Custom Guest Split Amounts Validation (Issue #10072)", () => {
  describe("calculateSplitBill core calculations and reconciliation", () => {
    const baseGuests = [
      { id: "guest-1", email: "g1@example.com", name: "Guest 1" },
      { id: "guest-2", email: "g2@example.com", name: "Guest 2" },
    ];

    it("should calculate exact equal shares without precision drift", () => {
      const summary = calculateSplitBill({
        bookingId: "b-1",
        venueName: "Coworking Lab",
        date: "2026-12-01",
        time: "10:00",
        totalAmount: 30,
        guests: baseGuests,
      });

      // 3 participants (1 host + 2 guests) on $30 -> $10 each
      expect(summary.totalAmount).toBe(30);
      expect(summary.guestShares[0].amount).toBe(10);
      expect(summary.guestShares[1].amount).toBe(10);
      expect(summary.hostShare).toBe(10);
      expect(
        summary.guestShares[0].amount +
          summary.guestShares[1].amount +
          summary.hostShare,
      ).toBe(30);
    });

    it("should reconcile rounding remainder cents to host share on indivisible totals", () => {
      const summary = calculateSplitBill({
        bookingId: "b-1",
        venueName: "Coworking Lab",
        date: "2026-12-01",
        time: "10:00",
        totalAmount: 10,
        guests: baseGuests,
      });

      // 10 / 3 = 3.33 with 1 cent remainder
      expect(summary.guestShares[0].amount).toBe(3.33);
      expect(summary.guestShares[1].amount).toBe(3.33);
      expect(summary.hostShare).toBe(3.34);

      const totalReconciled =
        summary.guestShares[0].amount +
        summary.guestShares[1].amount +
        summary.hostShare;
      expect(Number(totalReconciled.toFixed(2))).toBe(10);
    });

    it("should calculate valid custom guest amounts correctly", () => {
      const summary = calculateSplitBill({
        bookingId: "b-1",
        venueName: "Coworking Lab",
        date: "2026-12-01",
        time: "10:00",
        totalAmount: 100,
        guests: [
          { id: "guest-1", email: "g1@example.com", customAmount: 40 },
          { id: "guest-2", email: "g2@example.com", customAmount: 35 },
        ],
      });

      expect(summary.guestShares[0].amount).toBe(40);
      expect(summary.guestShares[1].amount).toBe(35);
      expect(summary.hostShare).toBe(25);
    });

    it("should throw an error when total custom guest allocations exceed total bill amount", () => {
      expect(() =>
        calculateSplitBill({
          bookingId: "b-1",
          venueName: "Coworking Lab",
          date: "2026-12-01",
          time: "10:00",
          totalAmount: 30,
          guests: [
            { id: "guest-1", email: "g1@example.com", customAmount: 50 },
          ],
        }),
      ).toThrow("exceeds total bill amount");
    });

    it("should throw an error when a custom amount is negative", () => {
      expect(() =>
        calculateSplitBill({
          bookingId: "b-1",
          venueName: "Coworking Lab",
          date: "2026-12-01",
          time: "10:00",
          totalAmount: 30,
          guests: [
            { id: "guest-1", email: "g1@example.com", customAmount: -10 },
          ],
        }),
      ).toThrow("finite non-negative number");
    });

    it("should throw an error when totalAmount is negative or non-finite", () => {
      expect(() =>
        calculateSplitBill({
          bookingId: "b-1",
          venueName: "Coworking Lab",
          date: "2026-12-01",
          time: "10:00",
          totalAmount: -30,
          guests: baseGuests,
        }),
      ).toThrow("finite non-negative number");
    });
  });

  describe("POST /api/bookings/[bookingId]/split-bill endpoint validation", () => {
    const mockBooking = {
      id: "booking-123",
      userId: "user-abc",
      date: "2026-12-01",
      time: "10:00",
      venue: {
        id: "v-1",
        name: "Test Venue",
        address: "123 St",
      },
      guests: [
        {
          id: "guest-valid-1",
          email: "g1@example.com",
          name: "Guest 1",
          paidAt: null,
        },
        {
          id: "guest-valid-2",
          email: "g2@example.com",
          name: "Guest 2",
          paidAt: null,
        },
      ],
    };

    beforeEach(() => {
      jest.clearAllMocks();
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user-abc" });
      (prisma.booking.findUnique as jest.Mock).mockResolvedValue(mockBooking);
    });

    it("should return HTTP 400 when negative custom amount is submitted", async () => {
      const req = new NextRequest(
        "http://localhost:3000/api/bookings/booking-123/split-bill",
        {
          method: "POST",
          body: JSON.stringify({
            totalAmount: 50,
            customGuestAmounts: {
              "guest-valid-1": -15,
            },
          }),
        },
      );

      const res = await POST(req, {
        params: Promise.resolve({ bookingId: "booking-123" }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Invalid request payload");
    });

    it("should return HTTP 400 when custom amount contains unknown guest ID", async () => {
      const req = new NextRequest(
        "http://localhost:3000/api/bookings/booking-123/split-bill",
        {
          method: "POST",
          body: JSON.stringify({
            totalAmount: 50,
            customGuestAmounts: {
              "unknown-guest-id": 20,
            },
          }),
        },
      );

      const res = await POST(req, {
        params: Promise.resolve({ bookingId: "booking-123" }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Unknown guest ID: unknown-guest-id");
    });

    it("should return HTTP 400 when custom guest amounts exceed total bill amount", async () => {
      const req = new NextRequest(
        "http://localhost:3000/api/bookings/booking-123/split-bill",
        {
          method: "POST",
          body: JSON.stringify({
            totalAmount: 30,
            customGuestAmounts: {
              "guest-valid-1": 25,
              "guest-valid-2": 15,
            },
          }),
        },
      );

      const res = await POST(req, {
        params: Promise.resolve({ bookingId: "booking-123" }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("exceed the total bill amount");
    });

    it("should return HTTP 200 and generate valid signed tokens for valid custom amounts", async () => {
      const req = new NextRequest(
        "http://localhost:3000/api/bookings/booking-123/split-bill",
        {
          method: "POST",
          body: JSON.stringify({
            totalAmount: 60,
            customGuestAmounts: {
              "guest-valid-1": 20,
              "guest-valid-2": 15,
            },
          }),
        },
      );

      const res = await POST(req, {
        params: Promise.resolve({ bookingId: "booking-123" }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.split.totalAmount).toBe(60);
      expect(json.split.guestShares[0].amount).toBe(20);
      expect(json.split.guestShares[1].amount).toBe(15);
      expect(json.split.hostShare).toBe(25);
      expect(json.split.guestShares[0].paymentToken).toBeDefined();
    });
  });
});
