import { NextRequest } from "next/server";
import { GET } from "@/app/api/admin/venues/[venueId]/export/route";
import { currentUser } from "@clerk/nextjs/server";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

jest.mock("@clerk/nextjs/server", () => ({
  currentUser: jest.fn(),
}));

jest.mock("@/lib/admin", () => ({
  getAdminUser: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findFirst: jest.fn(),
    },
    checkIn: {
      findMany: jest.fn(),
    },
    booking: {
      findMany: jest.fn(),
    },
    noiseTelemetryRelease: {
      findFirst: jest.fn(),
    },
  },
}));

describe("GET /api/admin/venues/[venueId]/export", () => {
  const venueId = "venue_test_123";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when the user is not authenticated", async () => {
    (currentUser as jest.Mock).mockResolvedValue(null);

    const req = new NextRequest(
      `http://localhost:3000/api/admin/venues/${venueId}/export`,
    );
    const res = await GET(req, { params: Promise.resolve({ venueId }) });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("returns 404 when venue does not exist", async () => {
    (currentUser as jest.Mock).mockResolvedValue({
      id: "admin_user",
      publicMetadata: { role: "admin" },
    });
    (getAdminUser as jest.Mock).mockResolvedValue({ id: "admin_user" });
    (prisma.venue.findFirst as jest.Mock).mockResolvedValue(null);

    const req = new NextRequest(
      `http://localhost:3000/api/admin/venues/${venueId}/export`,
    );
    const res = await GET(req, { params: Promise.resolve({ venueId }) });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Venue not found");
  });

  it("returns 403 when user is not an ADMIN or VENUE_OWNER", async () => {
    (currentUser as jest.Mock).mockResolvedValue({
      id: "regular_user",
      publicMetadata: { role: "member" },
    });
    (getAdminUser as jest.Mock).mockResolvedValue(null);
    (prisma.venue.findFirst as jest.Mock).mockResolvedValue({
      id: venueId,
      name: "Test Venue",
      ownerId: "someone_else",
      creatorId: null,
    });

    const req = new NextRequest(
      `http://localhost:3000/api/admin/venues/${venueId}/export`,
    );
    const res = await GET(req, { params: Promise.resolve({ venueId }) });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("Restricted to ADMIN or VENUE_OWNER roles");
  });

  it("returns 403 when a venue owner attempts to export another owner's venue", async () => {
    (currentUser as jest.Mock).mockResolvedValue({
      id: "owner_a",
      publicMetadata: { role: "venue_owner" },
    });
    (getAdminUser as jest.Mock).mockResolvedValue(null);
    (prisma.venue.findFirst as jest.Mock).mockResolvedValue({
      id: venueId,
      name: "Owner B's Venue",
      ownerId: "owner_b",
      creatorId: "owner_b",
    });

    const req = new NextRequest(
      `http://localhost:3000/api/admin/venues/${venueId}/export`,
    );
    const res = await GET(req, { params: Promise.resolve({ venueId }) });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("Not authorized for this venue");
  });

  it("returns 400 when an invalid format is requested", async () => {
    (currentUser as jest.Mock).mockResolvedValue({
      id: "admin_user",
      publicMetadata: { role: "admin" },
    });
    (getAdminUser as jest.Mock).mockResolvedValue({ id: "admin_user" });
    (prisma.venue.findFirst as jest.Mock).mockResolvedValue({
      id: venueId,
      name: "Test Venue",
      ownerId: "owner_1",
    });

    const req = new NextRequest(
      `http://localhost:3000/api/admin/venues/${venueId}/export?format=xml`,
    );
    const res = await GET(req, { params: Promise.resolve({ venueId }) });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Supported formats are 'csv' and 'pdf'");
  });

  it("returns 200 with RFC 4180 CSV stream and headers for ADMIN", async () => {
    (currentUser as jest.Mock).mockResolvedValue({
      id: "admin_user",
      publicMetadata: { role: "admin" },
    });
    (getAdminUser as jest.Mock).mockResolvedValue({ id: "admin_user" });
    (prisma.venue.findFirst as jest.Mock).mockResolvedValue({
      id: venueId,
      name: "Downtown Hub",
      ownerId: "owner_x",
    });

    (prisma.checkIn.findMany as jest.Mock).mockResolvedValue([
      {
        id: "ci_1",
        userId: "user_456",
        venueId,
        createdAt: new Date("2026-11-20T10:00:00Z"),
        expiresAt: new Date("2026-11-20T14:00:00Z"),
      },
    ]);
    (prisma.booking.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.noiseTelemetryRelease.findFirst as jest.Mock).mockResolvedValue({
      avgDecibels: 48.0,
    });

    const req = new NextRequest(
      `http://localhost:3000/api/admin/venues/${venueId}/export?format=csv&month=2026-11`,
    );
    const res = await GET(req, { params: Promise.resolve({ venueId }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toContain(
      `attachment; filename="venue-${venueId}-audit-2026-11.csv"`,
    );
    expect(res.headers.get("Cache-Control")).toBe(
      "private, no-store, max-age=0",
    );

    // Read the stream
    const reader = res.body?.getReader();
    expect(reader).toBeDefined();

    const decoder = new TextDecoder();
    let csvData = "";
    while (true) {
      const { value, done } = await reader!.read();
      if (done) break;
      csvData += decoder.decode(value);
    }

    const lines = csvData.split("\r\n").filter(Boolean);
    expect(lines[0]).toBe(
      "Timestamp,User ID,Seat Label,Check-in Duration,Average Decibels",
    );
    expect(lines[1]).toContain("user_456");
    expect(lines[1]).toContain("Hot Desk");
    expect(lines[1]).toContain("240 mins");
    expect(lines[1]).toContain("48.0");
  });

  it("returns 200 CSV stream for VENUE_OWNER of this venue", async () => {
    (currentUser as jest.Mock).mockResolvedValue({
      id: "owner_x",
      publicMetadata: { role: "venue_owner" },
    });
    (getAdminUser as jest.Mock).mockResolvedValue(null);
    (prisma.venue.findFirst as jest.Mock).mockResolvedValue({
      id: venueId,
      name: "Owner X Workspace",
      ownerId: "owner_x",
    });

    (prisma.checkIn.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.booking.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.noiseTelemetryRelease.findFirst as jest.Mock).mockResolvedValue(
      null,
    );

    const req = new NextRequest(
      `http://localhost:3000/api/admin/venues/${venueId}/export`,
    );
    const res = await GET(req, { params: Promise.resolve({ venueId }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
  });

  it("returns 200 with PDF binary stream when format=pdf", async () => {
    (currentUser as jest.Mock).mockResolvedValue({
      id: "admin_user",
      publicMetadata: { role: "admin" },
    });
    (getAdminUser as jest.Mock).mockResolvedValue({ id: "admin_user" });
    (prisma.venue.findFirst as jest.Mock).mockResolvedValue({
      id: venueId,
      name: "Downtown Hub",
      ownerId: "owner_x",
    });

    (prisma.checkIn.findMany as jest.Mock).mockResolvedValue([
      {
        id: "ci_1",
        userId: "user_789",
        venueId,
        createdAt: new Date("2026-11-20T10:00:00Z"),
        expiresAt: new Date("2026-11-20T12:00:00Z"),
      },
    ]);
    (prisma.booking.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.noiseTelemetryRelease.findFirst as jest.Mock).mockResolvedValue({
      avgDecibels: 42.1,
    });

    const req = new NextRequest(
      `http://localhost:3000/api/admin/venues/${venueId}/export?format=pdf&month=2026-11`,
    );
    const res = await GET(req, { params: Promise.resolve({ venueId }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain(
      `attachment; filename="venue-${venueId}-audit-2026-11.pdf"`,
    );

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    expect(buffer.toString("utf-8", 0, 5)).toBe("%PDF-");
  });
});
