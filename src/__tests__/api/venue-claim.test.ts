import { POST as claimPOST } from "../../app/api/venues/claim/route";
import {
  GET as managedGET,
  PUT as managedPUT,
} from "../../app/api/venues/managed/route";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

describe("Venue Claiming & Management APIs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("POST /api/venues/claim", () => {
    it("returns 401 if unauthenticated", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });
      const req = new NextRequest("http://localhost/api/venues/claim", {
        method: "POST",
        body: JSON.stringify({ venueId: "v1" }),
      });
      const res = await claimPOST(req);
      expect(res.status).toBe(401);
    });

    it("returns 400 if venueId is missing", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: "u1" });
      const req = new NextRequest("http://localhost/api/venues/claim", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const res = await claimPOST(req);
      expect(res.status).toBe(400);
    });

    it("returns 404 if venue is not found", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: "u1" });
      (prisma.venue.findUnique as jest.Mock).mockResolvedValue(null);

      const req = new NextRequest("http://localhost/api/venues/claim", {
        method: "POST",
        body: JSON.stringify({ venueId: "v1" }),
      });
      const res = await claimPOST(req);
      expect(res.status).toBe(404);
    });

    it("returns 400 if venue is already claimed", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: "u1" });
      (prisma.venue.findUnique as jest.Mock).mockResolvedValue({
        id: "v1",
        isClaimed: true,
      });

      const req = new NextRequest("http://localhost/api/venues/claim", {
        method: "POST",
        body: JSON.stringify({ venueId: "v1" }),
      });
      const res = await claimPOST(req);
      expect(res.status).toBe(400);
    });

    it("claims the venue successfully", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: "u1" });
      (prisma.venue.findUnique as jest.Mock).mockResolvedValue({
        id: "v1",
        isClaimed: false,
      });
      (prisma.venue.update as jest.Mock).mockResolvedValue({
        id: "v1",
        isClaimed: true,
        ownerId: "u1",
      });

      const req = new NextRequest("http://localhost/api/venues/claim", {
        method: "POST",
        body: JSON.stringify({ venueId: "v1" }),
      });
      const res = await claimPOST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.venue.isClaimed).toBe(true);
    });

    it("returns 400 when the request body is not valid JSON", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: "u1" });
      const req = new NextRequest("http://localhost/api/venues/claim", {
        method: "POST",
        body: "{",
        headers: { "content-type": "application/json" },
      });
      const res = await claimPOST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Invalid JSON body");
    });

    it("returns 400 when venueId is not a string", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: "u1" });
      const req = new NextRequest("http://localhost/api/venues/claim", {
        method: "POST",
        body: JSON.stringify({ venueId: { nested: true } }),
      });
      const res = await claimPOST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Venue ID is required");
    });

    it("returns 400 when venueId is blank whitespace", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: "u1" });
      const req = new NextRequest("http://localhost/api/venues/claim", {
        method: "POST",
        body: JSON.stringify({ venueId: "   " }),
      });
      const res = await claimPOST(req);
      expect(res.status).toBe(400);
    });

    it("does not leak internal error text when the database call fails", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: "u1" });
      (prisma.venue.findUnique as jest.Mock).mockRejectedValue(
        new Error("SQLSTATE 42P01 relation venues does not exist"),
      );
      const req = new NextRequest("http://localhost/api/venues/claim", {
        method: "POST",
        body: JSON.stringify({ venueId: "v1" }),
      });
      const res = await claimPOST(req);
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe("Internal Server Error");
      expect(JSON.stringify(data)).not.toContain("SQLSTATE");
    });
  });

  describe("GET /api/venues/managed", () => {
    it("returns claimed venues for the user", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: "u1" });
      (prisma.venue.findMany as jest.Mock).mockResolvedValue([
        { id: "v1", name: "My Café" },
      ]);

      const res = await managedGET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.length).toBe(1);
      expect(data[0].name).toBe("My Café");
    });
  });

  describe("PUT /api/venues/managed", () => {
    it("updates venue details if authorized", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: "u1" });
      (prisma.venue.findUnique as jest.Mock).mockResolvedValue({
        id: "v1",
        ownerId: "u1",
      });
      (prisma.venue.update as jest.Mock).mockResolvedValue({
        id: "v1",
        name: "New Name",
        hostMessage: "Hello",
      });

      const req = new NextRequest("http://localhost/api/venues/managed", {
        method: "PUT",
        body: JSON.stringify({
          venueId: "v1",
          name: "New Name",
          hostMessage: "Hello",
        }),
      });
      const res = await managedPUT(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.venue.name).toBe("New Name");
    });

    it("returns 403 if user is not the owner", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: "u1" });
      (prisma.venue.findUnique as jest.Mock).mockResolvedValue({
        id: "v1",
        ownerId: "someone-else",
      });

      const req = new NextRequest("http://localhost/api/venues/managed", {
        method: "PUT",
        body: JSON.stringify({
          venueId: "v1",
          name: "New Name",
        }),
      });
      const res = await managedPUT(req);
      expect(res.status).toBe(403);
    });
  });
});
