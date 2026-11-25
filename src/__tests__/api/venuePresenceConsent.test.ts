import { GET } from "@/app/api/venues/[venueId]/presence/route";
import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findFirst: jest.fn(),
    },
    workBuddyStatus: {
      findMany: jest.fn(),
    },
    checkIn: {
      findMany: jest.fn(),
    },
    booking: {
      findMany: jest.fn(),
    },
  },
}));

describe("Venue Presence Consent and Privacy Enforcement", () => {
  const mockAuth = auth as unknown as jest.Mock;
  const venueId = "venue_123";
  const context = { params: Promise.resolve({ venueId }) };

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.venue.findFirst as jest.Mock).mockResolvedValue({
      id: "venue_123",
      name: "Downtown Coworking",
    });
  });

  it("returns aggregate occupancy but zero PII for unauthenticated callers", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const future = new Date(Date.now() + 60 * 60 * 1000);
    (prisma.workBuddyStatus.findMany as jest.Mock).mockResolvedValue([
      {
        userId: "user_public",
        note: "Available for chat",
        until: future,
        user: {
          id: "user_public",
          firstName: "Alice",
          lastName: "Smith",
          imageUrl: "https://example.com/alice.jpg",
        },
      },
    ]);
    (prisma.checkIn.findMany as jest.Mock).mockResolvedValue([
      {
        userId: "user_checkedin",
        expiresAt: future,
        user: {
          id: "user_checkedin",
          firstName: "Bob",
          lastName: "Jones",
          imageUrl: "https://example.com/bob.jpg",
          workStatus: null,
        },
      },
    ]);
    (prisma.booking.findMany as jest.Mock).mockResolvedValue([]);

    const req = new NextRequest(
      `https://example.com/api/venues/${venueId}/presence`,
    );
    const res = await GET(req, context);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.activeCount).toBe(2);
    expect(data.totalOccupancy).toBe(2);
    expect(data.colleagues).toEqual([]); // Zero PII exposed to unauthenticated caller
    expect(data.isSelfPresent).toBe(false);
  });

  it("filters out check-in and booking attendees who have not opted into public presence", async () => {
    mockAuth.mockResolvedValue({ userId: "observer_user" });

    const future = new Date(Date.now() + 60 * 60 * 1000);

    // 1. User with explicit public WorkBuddy status
    (prisma.workBuddyStatus.findMany as jest.Mock).mockResolvedValue([
      {
        userId: "user_consented",
        note: "Working on TypeScript",
        until: future,
        user: {
          id: "user_consented",
          firstName: "Charlie",
          lastName: "Brown",
          imageUrl: "https://example.com/charlie.jpg",
        },
      },
    ]);

    // 2. User with active check-in but NO public consent (workStatus is null or isPublic: false)
    (prisma.checkIn.findMany as jest.Mock).mockResolvedValue([
      {
        userId: "user_private_checkin",
        expiresAt: future,
        user: {
          id: "user_private_checkin",
          firstName: "Private",
          lastName: "Person",
          imageUrl: "https://example.com/private.jpg",
          workStatus: null,
        },
      },
    ]);

    // 3. User with active booking but NO public consent
    (prisma.booking.findMany as jest.Mock).mockResolvedValue([
      {
        userId: "user_private_booking",
        time: "14:00",
        seatNumber: "Desk-4B",
        user: {
          id: "user_private_booking",
          firstName: "Secret",
          lastName: "Agent",
          imageUrl: "https://example.com/secret.jpg",
          workStatus: {
            isPublic: false,
            until: future,
            venueId: "venue_123",
          },
        },
      },
    ]);

    const req = new NextRequest(
      `https://example.com/api/venues/${venueId}/presence`,
    );
    const res = await GET(req, context);
    expect(res.status).toBe(200);

    const data = await res.json();
    // Aggregate occupancy includes all 3 active people
    expect(data.activeCount).toBe(3);
    expect(data.totalOccupancy).toBe(3);

    // Colleagues list contains ONLY Charlie Brown (who consented)
    expect(data.colleagues).toHaveLength(1);
    expect(data.colleagues[0].userId).toBe("user_consented");
    expect(data.colleagues[0].name).toBe("Charlie Brown");

    // Private attendees must NOT be disclosed
    const colleagueUserIds = data.colleagues.map((c: any) => c.userId);
    expect(colleagueUserIds).not.toContain("user_private_checkin");
    expect(colleagueUserIds).not.toContain("user_private_booking");
  });

  it("includes attendee details when they have opted into public presence at the venue", async () => {
    mockAuth.mockResolvedValue({ userId: "observer_user" });

    const future = new Date(Date.now() + 60 * 60 * 1000);
    (prisma.workBuddyStatus.findMany as jest.Mock).mockResolvedValue([]);

    // Check-in attendee with explicit public workStatus
    (prisma.checkIn.findMany as jest.Mock).mockResolvedValue([
      {
        userId: "user_consented_checkin",
        expiresAt: future,
        user: {
          id: "user_consented_checkin",
          firstName: "Dana",
          lastName: "Scully",
          imageUrl: "https://example.com/dana.jpg",
          workStatus: {
            isPublic: true,
            until: future,
            venueId: "venue_123",
          },
        },
      },
    ]);

    // Booking attendee with explicit public workStatus
    (prisma.booking.findMany as jest.Mock).mockResolvedValue([
      {
        userId: "user_consented_booking",
        time: "15:00",
        seatNumber: "Desk-10A",
        user: {
          id: "user_consented_booking",
          firstName: "Fox",
          lastName: "Mulder",
          imageUrl: "https://example.com/fox.jpg",
          workStatus: {
            isPublic: true,
            until: future,
            venueId: "venue_123",
          },
        },
      },
    ]);

    const req = new NextRequest(
      `https://example.com/api/venues/${venueId}/presence`,
    );
    const res = await GET(req, context);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.colleagues).toHaveLength(2);
    expect(data.colleagues.map((c: any) => c.userId)).toEqual(
      expect.arrayContaining([
        "user_consented_checkin",
        "user_consented_booking",
      ]),
    );
  });
});
