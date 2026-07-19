import { GET } from "../../app/api/bookings/[bookingId]/download/route";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import fs from "fs";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/auth", () => ({
  ensureUserExists: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    booking: {
      findFirst: jest.fn(),
    },
  },
}));

jest.mock("fs", () => {
  const actual = jest.requireActual("fs");
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: jest.fn(),
    },
  };
});

describe("GET /api/bookings/[bookingId]/download", () => {
  const mockAuth = auth as jest.Mock;
  const mockFindFirst = (prisma as any).booking.findFirst as jest.Mock;
  const mockReadFile = fs.promises.readFile as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 if unauthorized", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const req = {
      nextUrl: new URL("http://localhost/api/bookings/123/download"),
    };
    const context = { params: Promise.resolve({ bookingId: "123" }) };

    const res = await GET(req as any, context);
    expect(res.status).toBe(401);
  });

  it("returns 404 if booking not found", async () => {
    mockAuth.mockResolvedValue({ userId: "user_123" });
    mockFindFirst.mockResolvedValue(null);

    const req = {
      nextUrl: new URL("http://localhost/api/bookings/123/download"),
    };
    const context = { params: Promise.resolve({ bookingId: "123" }) };

    const res = await GET(req as any, context);
    expect(res.status).toBe(404);
  });

  it("returns 200 with PDF content type and reads fonts asynchronously", async () => {
    mockAuth.mockResolvedValue({ userId: "user_123" });
    mockFindFirst.mockResolvedValue({
      id: "booking_123",
      confirmationId: "WS-CONF-123",
      date: "2026-07-19",
      time: "12:00",
      duration: 3,
      projectBillingCode: "BILL-123",
      customerEmail: "customer@example.com",
      venue: {
        name: "Test Venue",
        category: "cafe",
        address: "123 Test St",
      },
      user: {
        firstName: "John",
        lastName: "Doe",
      },
    });

    // Mock readFile to return a dummy buffer
    mockReadFile.mockResolvedValue(Buffer.from("dummy-font-data"));

    const req = {
      nextUrl: new URL("http://localhost/api/bookings/booking_123/download?showLogo=true"),
    };
    const context = { params: Promise.resolve({ bookingId: "booking_123" }) };

    const res = await GET(req as any, context);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(mockReadFile).toHaveBeenCalledTimes(2);
  });
});
