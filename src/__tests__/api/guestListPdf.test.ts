import { GET } from "../../app/api/bookings/[bookingId]/guests/route";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { getBookingGuests } from "@/lib/guests";
import { generateGuestListPdf } from "@/lib/pdfGenerator";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    booking: {
      findUnique: jest.fn(),
    },
    bookingGuest: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock("@/lib/guests", () => ({
  getBookingGuests: jest.fn(),
  inviteGuestsToBooking: jest.fn(),
  cancelGuestInvitations: jest.fn(),
}));

jest.mock("@/lib/pdfGenerator", () => ({
  generateGuestListPdf: jest.fn(),
}));

describe("Guest List PDF Export (GET /api/bookings/[bookingId]/guests?format=pdf)", () => {
  const mockAuth = auth as unknown as jest.Mock;
  const mockFindUnique = (prisma as any).booking.findUnique as jest.Mock;
  const mockGetBookingGuests = getBookingGuests as jest.Mock;
  const mockGeneratePdf = generateGuestListPdf as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 if unauthorized", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const req = {
      url: "http://localhost/api/bookings/123/guests?format=pdf",
    } as any;
    const res = await GET(req, {
      params: Promise.resolve({ bookingId: "123" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 if booking does not belong to user", async () => {
    mockAuth.mockResolvedValue({ userId: "user_1" });
    mockFindUnique.mockResolvedValue({ userId: "user_2" }); // different user

    const req = {
      url: "http://localhost/api/bookings/123/guests?format=pdf",
    } as any;
    const res = await GET(req, {
      params: Promise.resolve({ bookingId: "123" }),
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("Forbidden");
  });

  it("returns 403 if booking is not confirmed", async () => {
    mockAuth.mockResolvedValue({ userId: "user_1" });
    mockFindUnique.mockResolvedValue({
      id: "123",
      userId: "user_1",
      status: "PENDING", // Not CONFIRMED
      venue: { name: "Test Venue" },
      user: { firstName: "Test", lastName: "User" },
    });

    const req = {
      url: "http://localhost/api/bookings/123/guests?format=pdf",
    } as any;
    const res = await GET(req, {
      params: Promise.resolve({ bookingId: "123" }),
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("Forbidden: booking is not confirmed");
  });

  it("returns empty guests array if no guests exist (empty state behavior)", async () => {
    mockAuth.mockResolvedValue({ userId: "user_1" });
    mockFindUnique.mockResolvedValue({
      id: "123",
      userId: "user_1",
      status: "CONFIRMED",
      venue: { name: "Test Venue" },
      user: { firstName: "Test", lastName: "User" },
    });
    mockGetBookingGuests.mockResolvedValue([]); // No guests

    const req = {
      url: "http://localhost/api/bookings/123/guests?format=pdf",
    } as any;
    const res = await GET(req, {
      params: Promise.resolve({ bookingId: "123" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.guests).toEqual([]);
    expect(mockGeneratePdf).not.toHaveBeenCalled();
  });

  it("returns PDF response with correct headers when guests exist", async () => {
    mockAuth.mockResolvedValue({ userId: "user_1" });
    mockFindUnique.mockResolvedValue({
      id: "123",
      userId: "user_1",
      status: "CONFIRMED",
      venue: { name: "Test Venue" },
      user: { firstName: "Test", lastName: "User" },
    });
    mockGetBookingGuests.mockResolvedValue([
      { id: "g1", email: "guest@example.com" },
    ]);

    const fakePdfBytes = new Uint8Array([1, 2, 3]);
    mockGeneratePdf.mockResolvedValue(fakePdfBytes);

    const req = {
      url: "http://localhost/api/bookings/123/guests?format=pdf",
    } as any;
    const res = await GET(req, {
      params: Promise.resolve({ bookingId: "123" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain(
      "GuestList_123.pdf",
    );
    expect(res.headers.get("Content-Length")).toBe("3");
    expect(mockGeneratePdf).toHaveBeenCalled();
  });
});
