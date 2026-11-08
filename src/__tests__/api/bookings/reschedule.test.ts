import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    booking: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    venueSeat: {
      findFirst: jest.fn(),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn((callback) => callback(prisma)),
  },
}));

jest.mock("@/lib/webhooks/deliver", () => ({
  emitWebhookEvent: jest.fn(),
}));

jest.mock("@/lib/reservations/event-bus", () => ({
  publishVenueAvailability: jest.fn(),
}));

jest.mock("@/lib/waitlist", () => ({
  notifyNextInWaitlist: jest.fn().mockResolvedValue(undefined),
}));

import { PATCH } from "@/app/api/bookings/[bookingId]/route";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { publishVenueAvailability } from "@/lib/reservations/event-bus";
import { emitWebhookEvent } from "@/lib/webhooks/deliver";

describe("PATCH /api/bookings/[bookingId] - Reschedule & Extend Flow", () => {
  const mockUserId = "user_123";
  const mockBookingId = "booking_abc";

  beforeEach(() => {
    jest.clearAllMocks();
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: mockUserId });
  });

  it("returns 401 if user is unauthenticated", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });

    const req = new NextRequest("http://localhost/api/bookings/booking_abc", {
      method: "PATCH",
      body: JSON.stringify({ date: "2026-10-10", time: "10:00" }),
    });

    const res = await PATCH(req, {
      params: Promise.resolve({ bookingId: mockBookingId }),
    });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 404 if booking is not found", async () => {
    (prisma.booking.findFirst as jest.Mock).mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/bookings/booking_abc", {
      method: "PATCH",
      body: JSON.stringify({ date: "2026-10-10", time: "10:00" }),
    });

    const res = await PATCH(req, {
      params: Promise.resolve({ bookingId: mockBookingId }),
    });

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Booking not found.");
  });

  it("returns 400 if booking is cancelled", async () => {
    (prisma.booking.findFirst as jest.Mock).mockResolvedValue({
      id: mockBookingId,
      userId: mockUserId,
      status: "CANCELLED",
      date: "2026-10-10",
      time: "10:00",
    });

    const req = new NextRequest("http://localhost/api/bookings/booking_abc", {
      method: "PATCH",
      body: JSON.stringify({ date: "2026-10-12", time: "14:00" }),
    });

    const res = await PATCH(req, {
      params: Promise.resolve({ bookingId: mockBookingId }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Cannot reschedule a cancelled booking.");
  });

  it("returns 400 if target duration is out of range", async () => {
    (prisma.booking.findFirst as jest.Mock).mockResolvedValue({
      id: mockBookingId,
      userId: mockUserId,
      status: "CONFIRMED",
      date: "2026-10-10",
      time: "10:00",
      venueId: "venue_1",
    });

    const req = new NextRequest("http://localhost/api/bookings/booking_abc", {
      method: "PATCH",
      body: JSON.stringify({ duration: 600 }), // > 480 min
    });

    const res = await PATCH(req, {
      params: Promise.resolve({ bookingId: mockBookingId }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Duration must be an integer between 30 and 480 minutes");
  });

  it("returns 409 if requested desk slot conflicts with another reservation", async () => {
    (prisma.booking.findFirst as jest.Mock).mockResolvedValue({
      id: mockBookingId,
      userId: mockUserId,
      status: "CONFIRMED",
      date: "2026-10-10",
      time: "10:00",
      duration: 60,
      venueId: "venue_1",
      seatId: "seat_99",
      seatNumber: "A1",
    });

    (prisma.venueSeat.findFirst as jest.Mock).mockResolvedValue({
      id: "seat_99",
      seatNumber: "A1",
      isEnabled: true,
    });

    // Existing conflicting booking on seat_99 from 14:00 to 16:00
    (prisma.booking.findMany as jest.Mock).mockResolvedValue([
      {
        date: "2026-10-15",
        time: "14:00",
        duration: 120,
        timeZone: "UTC",
      },
    ]);

    const req = new NextRequest("http://localhost/api/bookings/booking_abc", {
      method: "PATCH",
      body: JSON.stringify({
        date: "2026-10-15",
        time: "14:30",
        duration: 60,
      }),
    });

    const res = await PATCH(req, {
      params: Promise.resolve({ bookingId: mockBookingId }),
    });

    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("The requested time slot or desk is not available");
  });

  it("successfully reschedules and extends an active booking when slot is available", async () => {
    (prisma.booking.findFirst as jest.Mock).mockResolvedValue({
      id: mockBookingId,
      confirmationId: "WS-CONF-123",
      userId: mockUserId,
      status: "CONFIRMED",
      date: "2026-10-10",
      time: "10:00",
      duration: 60,
      venueId: "venue_1",
      seatId: "seat_99",
      seatNumber: "A1",
      venue: { id: "venue_1", name: "Desk Hub", address: "123 St", category: "coworking" },
    });

    (prisma.venueSeat.findFirst as jest.Mock).mockResolvedValue({
      id: "seat_99",
      seatNumber: "A1",
      isEnabled: true,
    });

    (prisma.booking.findMany as jest.Mock).mockResolvedValue([]);

    const mockUpdated = {
      id: mockBookingId,
      confirmationId: "WS-CONF-123",
      userId: mockUserId,
      status: "CONFIRMED",
      date: "2026-10-15",
      time: "11:00",
      duration: 120,
      seatId: "seat_99",
      seatNumber: "A1",
    };
    (prisma.booking.update as jest.Mock).mockResolvedValue(mockUpdated);

    const req = new NextRequest("http://localhost/api/bookings/booking_abc", {
      method: "PATCH",
      body: JSON.stringify({
        date: "2026-10-15",
        time: "11:00",
        duration: 120,
      }),
    });

    const res = await PATCH(req, {
      params: Promise.resolve({ bookingId: mockBookingId }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.message).toBe("Booking rescheduled successfully.");
    expect(data.booking).toEqual(mockUpdated);
  });

  describe("concurrency safety", () => {
    const activeBooking = {
      id: mockBookingId,
      confirmationId: "WS-CONF-123",
      userId: mockUserId,
      status: "CONFIRMED",
      date: "2026-10-10",
      time: "10:00",
      duration: 60,
      venueId: "venue_1",
      seatId: "seat_99",
      seatNumber: "A1",
      venue: { id: "venue_1", name: "Desk Hub", address: "123 St", category: "coworking" },
    };

    const rescheduleRequest = () =>
      new NextRequest("http://localhost/api/bookings/booking_abc", {
        method: "PATCH",
        body: JSON.stringify({ date: "2026-10-15", time: "11:00", duration: 60 }),
      });

    const callPatch = () =>
      PATCH(rescheduleRequest(), {
        params: Promise.resolve({ bookingId: mockBookingId }),
      });

    beforeEach(() => {
      // Pass-through transaction; reset so a failing test can't leak its
      // rejected/once implementations into the next one.
      (prisma.$transaction as jest.Mock).mockReset();
      (prisma.$transaction as jest.Mock).mockImplementation((cb) => cb(prisma));
      (prisma.booking.findFirst as jest.Mock).mockResolvedValue(activeBooking);
      (prisma.venueSeat.findFirst as jest.Mock).mockResolvedValue({
        id: "seat_99",
        seatNumber: "A1",
        isEnabled: true,
      });
      (prisma.booking.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.booking.update as jest.Mock).mockResolvedValue({
        ...activeBooking,
        date: "2026-10-15",
        time: "11:00",
      });
    });

    it("runs the conflict check and write in a Serializable transaction", async () => {
      const res = await callPatch();

      expect(res.status).toBe(200);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const options = (prisma.$transaction as jest.Mock).mock.calls[0][1];
      expect(options?.isolationLevel).toBe(
        Prisma.TransactionIsolationLevel.Serializable,
      );
    });

    it("row-locks the target seat before reading conflicting bookings", async () => {
      await callPatch();

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      const lockOrder = (prisma.$queryRaw as jest.Mock).mock
        .invocationCallOrder[0];
      const readOrder = (prisma.booking.findMany as jest.Mock).mock
        .invocationCallOrder[0];
      expect(lockOrder).toBeLessThan(readOrder);
    });

    it("only updates a booking that is still active (compare-and-set)", async () => {
      await callPatch();

      const args = (prisma.booking.update as jest.Mock).mock.calls[0][0];
      expect(args.where).toEqual({
        id: mockBookingId,
        userId: mockUserId,
        status: { in: ["CONFIRMED", "PENDING", "CHECKED_IN"] },
      });
    });

    it("returns 409 and emits no events when the booking was cancelled mid-flight", async () => {
      (prisma.booking.update as jest.Mock).mockRejectedValueOnce(
        Object.assign(new Error("Record to update not found."), {
          code: "P2025",
        }),
      );

      const res = await callPatch();

      expect(res.status).toBe(409);
      expect((await res.json()).error).toContain(
        "changed or cancelled by another request",
      );
      expect(publishVenueAvailability).not.toHaveBeenCalled();
      expect(emitWebhookEvent).not.toHaveBeenCalled();
    });

    it("retries a serialization failure and then succeeds", async () => {
      (prisma.$transaction as jest.Mock).mockRejectedValueOnce(
        Object.assign(new Error("could not serialize access"), {
          code: "P2034",
        }),
      );

      const res = await callPatch();

      expect(res.status).toBe(200);
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it("returns 409 when the retry sees the competing booking that won the race", async () => {
      // First attempt loses the race (40001); on retry the winner's booking is
      // visible, so the reschedule must be rejected instead of double-booking.
      (prisma.$transaction as jest.Mock).mockRejectedValueOnce(
        Object.assign(new Error("serialization failure"), { code: "40001" }),
      );
      (prisma.booking.findMany as jest.Mock).mockResolvedValue([
        { date: "2026-10-15", time: "11:00", duration: 60, timeZone: "UTC" },
      ]);

      const res = await callPatch();

      expect(res.status).toBe(409);
      expect((await res.json()).error).toContain(
        "The requested time slot or desk is not available",
      );
      expect(prisma.booking.update).not.toHaveBeenCalled();
      expect(publishVenueAvailability).not.toHaveBeenCalled();
    });

    it("does not retry non-transient errors", async () => {
      (prisma.$transaction as jest.Mock).mockRejectedValueOnce(
        new Error("connection reset by peer"),
      );
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      const res = await callPatch();

      expect(res.status).toBe(500);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      consoleSpy.mockRestore();
    });

    it("gives up after the retry budget is exhausted on persistent contention", async () => {
      (prisma.$transaction as jest.Mock).mockRejectedValue(
        Object.assign(new Error("serialization failure"), { code: "40001" }),
      );
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      const res = await callPatch();

      expect(res.status).toBe(500);
      expect(prisma.$transaction).toHaveBeenCalledTimes(4); // 1 try + 3 retries
      consoleSpy.mockRestore();
    });
  });
});
