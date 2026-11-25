import { NextRequest } from "next/server";
import { POST } from "@/app/api/bookings/[bookingId]/guests/route";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import * as guestManager from "@/lib/guests/guest-manager";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/auth", () => ({
  ensureUserExists: jest.fn().mockResolvedValue({ id: "user_123" }),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    booking: {
      findUnique: jest.fn(),
    },
    bookingGuest: {
      findMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn((ops) => Promise.all(ops)),
  },
}));

jest.mock("@/core/events", () => ({
  eventBus: {
    emit: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("@/core/subscribers/guests", () => ({}));

describe("Duplicate Guest Emails Handling (Issue #10068)", () => {
  const mockBooking = {
    id: "booking-123",
    userId: "user_123",
    customerEmail: "host@example.com",
    confirmationId: "CONF-999",
    date: "2026-12-01",
    time: "14:00",
    duration: 60,
    status: "CONFIRMED",
    user: {
      firstName: "Host",
      lastName: "User",
    },
    venue: {
      name: "Test Venue",
      address: "123 Venue St",
      latitude: 40.7128,
      longitude: -74.006,
      imageUrl: "https://example.com/venue.jpg",
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user_123" });
    (prisma.booking.findUnique as jest.Mock).mockResolvedValue(mockBooking);
  });

  it("should reject request with HTTP 400 when duplicate emails are in the same payload", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/bookings/booking-123/guests",
      {
        method: "POST",
        body: JSON.stringify({
          guests: [
            { email: "guest@example.com", name: "Guest One" },
            { email: "guest@example.com", name: "Guest Duplicate" },
          ],
        }),
      },
    );

    const res = await POST(req, {
      params: Promise.resolve({ bookingId: "booking-123" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Duplicate guest email addresses found");
    expect(body.duplicates).toContain("guest@example.com");
  });

  it("should normalize email casing and reject case-insensitive duplicates with HTTP 400", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/bookings/booking-123/guests",
      {
        method: "POST",
        body: JSON.stringify({
          guests: [
            { email: "Alice@EXAMPLE.com", name: "Alice uppercase" },
            { email: "alice@example.com", name: "Alice lowercase" },
          ],
        }),
      },
    );

    const res = await POST(req, {
      params: Promise.resolve({ bookingId: "booking-123" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.duplicates).toContain("alice@example.com");
  });

  it("should return HTTP 409 Conflict when guest email is already invited to the booking", async () => {
    (prisma.bookingGuest.findMany as jest.Mock).mockResolvedValue([
      { email: "existing@example.com", status: "PENDING" },
    ]);

    const req = new NextRequest(
      "http://localhost:3000/api/bookings/booking-123/guests",
      {
        method: "POST",
        body: JSON.stringify({
          guests: [{ email: "existing@example.com", name: "Existing Guest" }],
        }),
      },
    );

    const res = await POST(req, {
      params: Promise.resolve({ bookingId: "booking-123" }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("already been invited");
    expect(body.existingGuests).toEqual([
      { email: "existing@example.com", status: "PENDING" },
    ]);
  });

  it("should return HTTP 409 on Prisma unique constraint violation code P2002", async () => {
    (prisma.bookingGuest.findMany as jest.Mock).mockResolvedValue([]);
    jest.spyOn(guestManager, "inviteGuestsToBooking").mockRejectedValueOnce({
      code: "P2002",
      message: "Unique constraint failed on the fields: (`bookingId`,`email`)",
    });

    const req = new NextRequest(
      "http://localhost:3000/api/bookings/booking-123/guests",
      {
        method: "POST",
        body: JSON.stringify({
          guests: [{ email: "race@example.com", name: "Race Guest" }],
        }),
      },
    );

    const res = await POST(req, {
      params: Promise.resolve({ bookingId: "booking-123" }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("already been invited");
  });

  it("should succeed with HTTP 200 when unique valid guests are submitted", async () => {
    (prisma.bookingGuest.findMany as jest.Mock).mockResolvedValue([]);
    jest.spyOn(guestManager, "inviteGuestsToBooking").mockResolvedValueOnce([
      { email: "valid1@example.com", success: true, calendarUid: "uid-1" },
      { email: "valid2@example.com", success: true, calendarUid: "uid-2" },
    ]);

    const req = new NextRequest(
      "http://localhost:3000/api/bookings/booking-123/guests",
      {
        method: "POST",
        body: JSON.stringify({
          guests: [
            { email: "valid1@example.com", name: "Valid 1" },
            { email: "valid2@example.com", name: "Valid 2" },
          ],
        }),
      },
    );

    const res = await POST(req, {
      params: Promise.resolve({ bookingId: "booking-123" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.summary.sent).toBe(2);
    expect(body.summary.failed).toBe(0);
  });
});
