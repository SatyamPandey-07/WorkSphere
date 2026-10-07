import {
  GET,
  computeStatus,
  STATUS_THRESHOLD,
} from "@/app/api/availability/delta/route";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    favorite: {
      findMany: jest.fn(),
    },
    venue: {
      findMany: jest.fn(),
    },
  },
}));

const mockAuth = auth as unknown as jest.Mock;
const mockFavoriteFindMany = prisma.favorite.findMany as jest.Mock;
const mockVenueFindMany = prisma.venue.findMany as jest.Mock;

describe("GET /api/availability/delta", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("computeStatus logic", () => {
    it("has correct threshold values for yellow and red", () => {
      expect(STATUS_THRESHOLD.yellow).toBe(0.6);
      expect(STATUS_THRESHOLD.red).toBe(1);
    });

    it("returns 'red' when capacity is zero or negative", () => {
      expect(computeStatus(0, 0)).toBe("red");
      expect(computeStatus(5, -1)).toBe("red");
    });

    it("returns 'green' when occupancy ratio is below 0.6", () => {
      expect(computeStatus(0, 100)).toBe("green");
      expect(computeStatus(30, 100)).toBe("green");
      expect(computeStatus(59, 100)).toBe("green");
    });

    it("returns 'yellow' when occupancy ratio is between 0.6 and below 1.0", () => {
      expect(computeStatus(60, 100)).toBe("yellow");
      expect(computeStatus(80, 100)).toBe("yellow");
      expect(computeStatus(99, 100)).toBe("yellow");
    });

    it("returns 'red' when occupancy ratio is 1.0 or greater (at or over capacity)", () => {
      expect(computeStatus(100, 100)).toBe("red");
      expect(computeStatus(120, 100)).toBe("red");
    });
  });

  describe("Route handler", () => {
    it("returns empty venues array when user is not authenticated", async () => {
      mockAuth.mockResolvedValue({ userId: null });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ venues: [] });
      expect(mockFavoriteFindMany).not.toHaveBeenCalled();
    });

    it("returns empty venues array when user has no favorites", async () => {
      mockAuth.mockResolvedValue({ userId: "user_123" });
      mockFavoriteFindMany.mockResolvedValue([]);

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ venues: [] });
      expect(mockFavoriteFindMany).toHaveBeenCalledWith({
        where: { userId: "user_123" },
        select: { venueId: true },
      });
      expect(mockVenueFindMany).not.toHaveBeenCalled();
    });

    it("returns mapped venues with correct occupancy and availability statuses", async () => {
      mockAuth.mockResolvedValue({ userId: "user_123" });
      mockFavoriteFindMany.mockResolvedValue([
        { venueId: "venue_1" },
        { venueId: "venue_2" },
        { venueId: "venue_3" },
      ]);
      mockVenueFindMany.mockResolvedValue([
        {
          id: "venue_1",
          name: "Quiet Hub",
          currentOccupancy: 20,
          maxCapacity: 100,
        },
        {
          id: "venue_2",
          name: "Busy Cafe",
          currentOccupancy: 80,
          maxCapacity: 100,
        },
        {
          id: "venue_3",
          name: "Packed Lounge",
          currentOccupancy: 100,
          maxCapacity: 100,
        },
      ]);

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(mockVenueFindMany).toHaveBeenCalledWith({
        where: { id: { in: ["venue_1", "venue_2", "venue_3"] } },
        select: {
          id: true,
          name: true,
          currentOccupancy: true,
          maxCapacity: true,
        },
      });

      expect(data.venues).toEqual([
        {
          venueId: "venue_1",
          venueName: "Quiet Hub",
          count: 20,
          capacity: 100,
          status: "green",
        },
        {
          venueId: "venue_2",
          venueName: "Busy Cafe",
          count: 80,
          capacity: 100,
          status: "yellow",
        },
        {
          venueId: "venue_3",
          venueName: "Packed Lounge",
          count: 100,
          capacity: 100,
          status: "red",
        },
      ]);
    });

    it("handles unexpected errors gracefully by returning empty venues array", async () => {
      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      mockAuth.mockRejectedValue(new Error("Database connection failure"));

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ venues: [] });
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });
});
