import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/bookings/route";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@clerk/nextjs/server";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    booking: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock("@clerk/nextjs/server", () => ({
  currentUser: jest.fn(),
}));

describe("API: /api/bookings", () => {
  const mockUser = {
    id: "user_123",
    primaryEmailAddress: {
      emailAddress: "test@example.com",
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /api/bookings", () => {
    it("returns 401 if user is not authenticated", async () => {
      (currentUser as jest.Mock).mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/bookings");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({ error: "Unauthorized" });
      expect(prisma.booking.findMany).not.toHaveBeenCalled();
    });

    it("returns bookings for authenticated user", async () => {
      (currentUser as jest.Mock).mockResolvedValue(mockUser);
      const mockBookings = [
        {
          id: "b_1",
          userId: mockUser.id,
          venueId: "v_1",
          date: "2026-10-01",
          time: "10:00",
          confirmationId: "WS-A1B2C3",
          status: "CONFIRMED",
          venue: { id: "v_1", name: "Cafe Hub" },
        },
      ];
      (prisma.booking.findMany as jest.Mock).mockResolvedValue(mockBookings);

      const request = new NextRequest("http://localhost:3000/api/bookings");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ success: true, data: mockBookings });
      expect(prisma.booking.findMany).toHaveBeenCalledWith({
        where: { userId: mockUser.id },
        include: { venue: true },
        orderBy: { createdAt: "desc" },
      });
    });

    it("handles internal server error gracefully", async () => {
      (currentUser as jest.Mock).mockResolvedValue(mockUser);
      (prisma.booking.findMany as jest.Mock).mockRejectedValue(
        new Error("Database connection error"),
      );

      const request = new NextRequest("http://localhost:3000/api/bookings");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({ error: "Internal Server Error" });
    });
  });

  describe("POST /api/bookings", () => {
    it("returns 401 if user is not authenticated", async () => {
      (currentUser as jest.Mock).mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/bookings", {
        method: "POST",
        body: JSON.stringify({
          venueId: "v_1",
          date: "2026-10-01",
          time: "14:00",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({ error: "Unauthorized or missing email" });
    });

    it("returns 400 on invalid booking input data", async () => {
      (currentUser as jest.Mock).mockResolvedValue(mockUser);

      const request = new NextRequest("http://localhost:3000/api/bookings", {
        method: "POST",
        body: JSON.stringify({
          venueId: "",
          date: "invalid-date",
          time: "invalid-time",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid booking data");
      expect(data.details).toBeDefined();
    });

    it("creates a single booking when single date is provided", async () => {
      (currentUser as jest.Mock).mockResolvedValue(mockUser);

      (prisma.$transaction as jest.Mock).mockImplementation(
        async (promises: Promise<any>[]) => Promise.all(promises),
      );

      (prisma.booking.create as jest.Mock).mockImplementation(
        async ({ data }: any) => ({
          id: `booking_${Math.random()}`,
          ...data,
          venue: { id: data.venueId, name: "Cafe Hub" },
        }),
      );

      const request = new NextRequest("http://localhost:3000/api/bookings", {
        method: "POST",
        body: JSON.stringify({
          venueId: "v_1",
          date: "2026-10-01",
          time: "14:00",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].venueId).toBe("v_1");
      expect(data.data[0].date).toBe("2026-10-01");
      expect(data.data[0].time).toBe("14:00");
      expect(data.data[0].customerEmail).toBe(
        mockUser.primaryEmailAddress.emailAddress,
      );
      expect(data.data[0].confirmationId).toMatch(/^WS-[0-9A-F]{6}$/);
    });

    it("creates multiple bookings with distinct, unique confirmationIds in a multi-date reservation", async () => {
      (currentUser as jest.Mock).mockResolvedValue(mockUser);

      const capturedCreatePayloads: any[] = [];
      (prisma.$transaction as jest.Mock).mockImplementation(
        async (promises: Promise<any>[]) => {
          return Promise.all(promises);
        },
      );

      (prisma.booking.create as jest.Mock).mockImplementation(
        async ({ data }: any) => {
          capturedCreatePayloads.push(data);
          return {
            id: `booking_${data.date}`,
            ...data,
            venue: { id: data.venueId, name: "Workspace" },
          };
        },
      );

      const dates = ["2026-10-01", "2026-10-02", "2026-10-03"];
      const request = new NextRequest("http://localhost:3000/api/bookings", {
        method: "POST",
        body: JSON.stringify({
          venueId: "v_123",
          dates,
          time: "09:30",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(3);

      // Verify that every booking creation received a unique confirmationId
      expect(capturedCreatePayloads).toHaveLength(3);
      const confirmationIds = capturedCreatePayloads.map(
        (p) => p.confirmationId,
      );

      // Check format: WS-XXXXXX (6 hex chars)
      confirmationIds.forEach((id) => {
        expect(id).toMatch(/^WS-[0-9A-F]{6}$/);
      });

      // Crucial: ensure no two confirmationIds are identical (unique constraint)
      const uniqueIds = new Set(confirmationIds);
      expect(uniqueIds.size).toBe(3);
    });

    it.each([
      ["impossible calendar date (Feb 31)", { date: "2026-02-31", time: "14:00" }],
      ["impossible calendar date (Apr 31)", { date: "2026-04-31", time: "14:00" }],
      ["non-leap-year Feb 29", { date: "2027-02-29", time: "14:00" }],
      ["hour out of range (99:99)", { date: "2026-10-01", time: "99:99" }],
      ["hour out of range (25:00)", { date: "2026-10-01", time: "25:00" }],
      ["24:00 (not a valid HH:mm)", { date: "2026-10-01", time: "24:00" }],
      ["minutes out of range (12:60)", { date: "2026-10-01", time: "12:60" }],
    ])(
      "returns 400 and stores nothing for %s",
      async (_label, input) => {
        (currentUser as jest.Mock).mockResolvedValue(mockUser);

        const request = new NextRequest("http://localhost:3000/api/bookings", {
          method: "POST",
          body: JSON.stringify({ venueId: "v_1", ...input }),
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.error).toBe("Invalid booking data");
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.booking.create).not.toHaveBeenCalled();
      },
    );

    it("rejects the whole request if any date in a multi-date booking is invalid", async () => {
      (currentUser as jest.Mock).mockResolvedValue(mockUser);

      const request = new NextRequest("http://localhost:3000/api/bookings", {
        method: "POST",
        body: JSON.stringify({
          venueId: "v_1",
          dates: ["2026-10-01", "2026-02-31"],
          time: "09:00",
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      expect(prisma.booking.create).not.toHaveBeenCalled();
    });

    it("returns 400 (not 500) for a malformed JSON body", async () => {
      (currentUser as jest.Mock).mockResolvedValue(mockUser);

      const request = new NextRequest("http://localhost:3000/api/bookings", {
        method: "POST",
        body: "{not valid json",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid booking data");
    });

    it("accepts boundary values 00:00 and 23:59", async () => {
      (currentUser as jest.Mock).mockResolvedValue(mockUser);
      (prisma.$transaction as jest.Mock).mockImplementation(
        async (promises: Promise<any>[]) => Promise.all(promises),
      );
      (prisma.booking.create as jest.Mock).mockImplementation(
        async ({ data }: any) => ({ id: "b", ...data, venue: {} }),
      );

      for (const time of ["00:00", "23:59"]) {
        const request = new NextRequest("http://localhost:3000/api/bookings", {
          method: "POST",
          body: JSON.stringify({ venueId: "v_1", date: "2028-02-29", time }),
        });
        const response = await POST(request);
        expect(response.status).toBe(200);
      }
    });

    it("returns 500 if transaction fails", async () => {
      (currentUser as jest.Mock).mockResolvedValue(mockUser);
      (prisma.$transaction as jest.Mock).mockRejectedValue(
        new Error("Database transaction aborted"),
      );

      const request = new NextRequest("http://localhost:3000/api/bookings", {
        method: "POST",
        body: JSON.stringify({
          venueId: "v_1",
          dates: ["2026-10-01", "2026-10-02"],
          time: "14:00",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({ error: "Failed to create reservation" });
    });
  });
});
