import { POST } from "@/app/api/security/qr-passcard/issue/route";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { parseBookingDateTime, isValidTimeZone } from "@/lib/bookingTime";
import { issuePasscard } from "@/lib/security/serverOfflinePasscardIssuer";

jest.mock("@clerk/nextjs/server", () => ({ auth: jest.fn() }));
jest.mock("@/lib/prisma", () => ({
  prisma: { booking: { findFirst: jest.fn() } },
}));
jest.mock("@/lib/rateLimit", () => ({ rateLimit: jest.fn() }));
jest.mock("@/lib/bookingTime", () => ({
  isValidTimeZone: jest.fn(),
  parseBookingDateTime: jest.fn(),
}));
jest.mock("@/lib/security/serverOfflinePasscardIssuer", () => ({
  issuePasscard: jest.fn(),
}));

const mockAuth = auth as jest.Mock;
const mockFindBooking = prisma.booking.findFirst as jest.Mock;
const mockRateLimit = rateLimit as jest.Mock;
const mockParseBookingTime = parseBookingDateTime as jest.Mock;
const mockValidZone = isValidTimeZone as jest.Mock;
const mockIssuePasscard = issuePasscard as jest.Mock;

describe("POST /api/security/qr-passcard/issue", () => {
  const activeBooking = {
    id: "booking-1",
    userId: "user-1",
    venueId: "venue-1",
    date: "2026-11-15",
    time: "14:00",
    timeZone: "Asia/Kolkata",
    duration: 60,
    seatNumber: "A-4",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: "user-1" });
    mockFindBooking.mockResolvedValue(activeBooking);
    mockRateLimit.mockResolvedValue(true);
    mockValidZone.mockReturnValue(true);
    mockParseBookingTime.mockReturnValue(new Date(Date.now() - 5 * 60 * 1000));
    mockIssuePasscard.mockResolvedValue("signed.payload");
  });

  it("rejects unauthenticated requests", async () => {
    mockAuth.mockResolvedValueOnce({});
    const response = await POST(
      new Request("http://localhost/api/security/qr-passcard/issue", {
        method: "POST",
        body: JSON.stringify({ bookingId: "booking-1" }),
      }),
    );
    expect(response.status).toBe(401);
    expect(mockFindBooking).not.toHaveBeenCalled();
  });

  it("validates the booking ID before database access", async () => {
    const response = await POST(
      new Request("http://localhost/api/security/qr-passcard/issue", {
        method: "POST",
        body: JSON.stringify({ bookingId: "" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(mockFindBooking).not.toHaveBeenCalled();
  });

  it("returns not found for a missing or non-owned booking", async () => {
    mockFindBooking.mockResolvedValueOnce(null);
    const response = await POST(
      new Request("http://localhost/api/security/qr-passcard/issue", {
        method: "POST",
        body: JSON.stringify({ bookingId: "booking-1" }),
      }),
    );
    expect(response.status).toBe(404);
    expect(mockIssuePasscard).not.toHaveBeenCalled();
  });

  it("reissues a signed token only for the authenticated owner's active booking", async () => {
    const response = await POST(
      new Request("http://localhost/api/security/qr-passcard/issue", {
        method: "POST",
        body: JSON.stringify({ bookingId: "booking-1" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, offlinePasscard: "signed.payload" });
    expect(mockFindBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "booking-1",
          userId: "user-1",
          status: { in: ["CONFIRMED", "CHECKED_IN"] },
        },
      }),
    );
    expect(mockIssuePasscard).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "booking-1",
        userId: "user-1",
        venueId: "venue-1",
        durationMinutes: 60,
      }),
    );
  });

  it("refuses to renew a booking whose reserved window has ended", async () => {
    mockParseBookingTime.mockReturnValueOnce(
      new Date(Date.now() - 2 * 60 * 60 * 1000),
    );
    const response = await POST(
      new Request("http://localhost/api/security/qr-passcard/issue", {
        method: "POST",
        body: JSON.stringify({ bookingId: "booking-1" }),
      }),
    );
    expect(response.status).toBe(410);
    expect(mockIssuePasscard).not.toHaveBeenCalled();
  });

  it("enforces a per-user renewal limit", async () => {
    mockRateLimit.mockResolvedValueOnce(false);
    const response = await POST(
      new Request("http://localhost/api/security/qr-passcard/issue", {
        method: "POST",
        body: JSON.stringify({ bookingId: "booking-1" }),
      }),
    );
    expect(response.status).toBe(429);
    expect(mockFindBooking).not.toHaveBeenCalled();
  });
});
