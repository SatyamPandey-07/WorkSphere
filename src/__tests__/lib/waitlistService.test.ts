jest.mock("@/lib/notifications/dispatcher", () => ({
  NotificationDispatcher: class {
    async dispatch() {}
  },
}));

const mockVenues = [
  { id: "venue_1", name: "Coworking Central" },
  { id: "venue_2", name: "Quiet Space Hub" },
];

const mockSeats = [
  { id: "seat_v1_1", venueId: "venue_1", seatNumber: "A1" },
  { id: "seat_v1_2", venueId: "venue_1", seatNumber: "A2" },
  { id: "seat_v2_1", venueId: "venue_2", seatNumber: "B1" },
];

const mockWaitlist: any[] = [];
let mockIdCounter = 1;

const mockDefaultFindFirst = async ({ where }: any) => {
  const match = mockWaitlist.find((w) => {
    if (where.userId && w.userId !== where.userId) return false;
    if (where.venueId && w.venueId !== where.venueId) return false;
    if (where.date && w.date !== where.date) return false;
    if (where.time && w.time !== where.time) return false;
    if (where.status?.in && !where.status.in.includes(w.status)) return false;
    return true;
  });
  if (!match) return null;
  const venue = mockVenues.find((v) => v.id === match.venueId);
  const seat = mockSeats.find((s) => s.id === match.seatId);
  return {
    ...match,
    venue: venue ? { name: venue.name } : null,
    seat: seat ? { seatNumber: seat.seatNumber } : null,
  };
};

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findUnique: jest.fn(async ({ where }: any) => {
        return mockVenues.find((v) => v.id === where.id) || null;
      }),
    },
    venueSeat: {
      findUnique: jest.fn(async ({ where }: any) => {
        return mockSeats.find((s) => s.id === where.id) || null;
      }),
    },
    venueSeatWaitlist: {
      findFirst: jest.fn(mockDefaultFindFirst),
      create: jest.fn(async ({ data }: any) => {
        // Check uniqueness invariant: (userId, venueId, date, time) WHERE status IN ('ACTIVE', 'NOTIFIED')
        const conflict = mockWaitlist.find(
          (w) =>
            w.userId === data.userId &&
            w.venueId === data.venueId &&
            w.date === data.date &&
            w.time === data.time &&
            ["ACTIVE", "NOTIFIED"].includes(w.status),
        );

        if (conflict) {
          const err: any = new Error(
            "Unique constraint failed on the fields: (`userId`,`venueId`,`date`,`time`)",
          );
          err.code = "P2002";
          err.meta = { target: ["VenueSeatWaitlist_active_uniqueness_idx"] };
          throw err;
        }

        const now = Date.now();
        const record = {
          id: `waitlist_${mockIdCounter}`,
          ...data,
          createdAt: new Date(now + mockIdCounter * 100),
          updatedAt: new Date(now + mockIdCounter * 100),
        };
        mockIdCounter++;
        mockWaitlist.push(record);

        const venue = mockVenues.find((v) => v.id === record.venueId);
        const seat = mockSeats.find((s) => s.id === record.seatId);
        return {
          ...record,
          venue: venue ? { name: venue.name } : null,
          seat: seat ? { seatNumber: seat.seatNumber } : null,
        };
      }),
      count: jest.fn(async ({ where }: any) => {
        return mockWaitlist.filter((w) => {
          if (where.venueId && w.venueId !== where.venueId) return false;
          if (where.date && w.date !== where.date) return false;
          if (where.time && w.time !== where.time) return false;
          if (where.status?.in && !where.status.in.includes(w.status))
            return false;
          if (where.createdAt?.lt && !(w.createdAt < where.createdAt.lt))
            return false;
          if (where.createdAt?.lte && !(w.createdAt <= where.createdAt.lte))
            return false;
          return true;
        }).length;
      }),
    },
  },
}));

import { joinVenueWaitlist } from "@/lib/waitlist/waitlistService";
import { prisma } from "@/lib/prisma";

describe("joinVenueWaitlist Service", () => {
  beforeEach(() => {
    mockWaitlist.length = 0;
    mockIdCounter = 1;
    (prisma.venueSeatWaitlist.findFirst as jest.Mock).mockImplementation(
      mockDefaultFindFirst,
    );
    jest.clearAllMocks();
  });

  it("successfully joins waitlist on first valid request without seatId", async () => {
    const result = await joinVenueWaitlist("user_1", {
      venueId: "venue_1",
      date: "2026-12-01",
      time: "10:00",
      duration: 60,
    });

    expect(result.success).toBe(true);
    expect(result.entry.userId).toBe("user_1");
    expect(result.entry.venueId).toBe("venue_1");
    expect(result.entry.seatId).toBeNull();
    expect(result.entry.queuePosition).toBe(1);
    expect(result.message).toContain("Successfully joined waitlist!");
  });

  it("successfully joins waitlist on first valid request with valid seatId", async () => {
    const result = await joinVenueWaitlist("user_1", {
      venueId: "venue_1",
      seatId: "seat_v1_1",
      date: "2026-12-01",
      time: "10:00",
      duration: 60,
    });

    expect(result.success).toBe(true);
    expect(result.entry.seatId).toBe("seat_v1_1");
    expect(result.entry.queuePosition).toBe(1);
  });

  it("rejects non-existent seat with clear error", async () => {
    await expect(
      joinVenueWaitlist("user_1", {
        venueId: "venue_1",
        seatId: "non_existent_seat",
        date: "2026-12-01",
        time: "10:00",
      }),
    ).rejects.toThrow("Seat not found.");
  });

  it("rejects cross-venue seat that belongs to another venue", async () => {
    await expect(
      joinVenueWaitlist("user_1", {
        venueId: "venue_1",
        seatId: "seat_v2_1",
        date: "2026-12-01",
        time: "10:00",
      }),
    ).rejects.toThrow("The specified seat does not belong to this venue.");
  });

  it("returns idempotent response for duplicate sequential request by same user", async () => {
    const first = await joinVenueWaitlist("user_1", {
      venueId: "venue_1",
      date: "2026-12-01",
      time: "10:00",
    });
    expect(first.success).toBe(true);
    expect(first.message).toContain("Successfully joined waitlist!");

    const duplicate = await joinVenueWaitlist("user_1", {
      venueId: "venue_1",
      date: "2026-12-01",
      time: "10:00",
    });

    expect(duplicate.success).toBe(true);
    expect(duplicate.entry.id).toBe(first.entry.id);
    expect(duplicate.message).toBe(
      "You are already on the waitlist for this time slot.",
    );
  });

  it("safely handles concurrency race where create hits P2002 uniqueness violation", async () => {
    const first = await joinVenueWaitlist("user_1", {
      venueId: "venue_1",
      date: "2026-12-01",
      time: "10:00",
    });

    let calls = 0;
    (prisma.venueSeatWaitlist.findFirst as jest.Mock).mockImplementation(
      async (args: any) => {
        calls++;
        if (calls === 1) {
          return null;
        }
        return mockDefaultFindFirst(args);
      },
    );

    const concurrentResult = await joinVenueWaitlist("user_1", {
      venueId: "venue_1",
      date: "2026-12-01",
      time: "10:00",
    });

    expect(concurrentResult.success).toBe(true);
    expect(concurrentResult.entry.id).toBe(first.entry.id);
    expect(concurrentResult.message).toBe(
      "You are already on the waitlist for this time slot.",
    );
  });

  it("allows different users to join the same venue, date, and time slot", async () => {
    const user1 = await joinVenueWaitlist("user_1", {
      venueId: "venue_1",
      date: "2026-12-01",
      time: "10:00",
    });
    const user2 = await joinVenueWaitlist("user_2", {
      venueId: "venue_1",
      date: "2026-12-01",
      time: "10:00",
    });

    expect(user1.success).toBe(true);
    expect(user2.success).toBe(true);
    expect(user1.entry.queuePosition).toBe(1);
    expect(user2.entry.queuePosition).toBe(2);
  });

  it("allows the same user to join different time slots or venues independently", async () => {
    const slot1 = await joinVenueWaitlist("user_1", {
      venueId: "venue_1",
      date: "2026-12-01",
      time: "10:00",
    });
    const slot2 = await joinVenueWaitlist("user_1", {
      venueId: "venue_1",
      date: "2026-12-01",
      time: "14:00",
    });
    const venue2Slot = await joinVenueWaitlist("user_1", {
      venueId: "venue_2",
      date: "2026-12-01",
      time: "10:00",
    });

    expect(slot1.success).toBe(true);
    expect(slot2.success).toBe(true);
    expect(venue2Slot.success).toBe(true);
  });

  it("allows user to rejoin after prior waitlist entry was CANCELLED", async () => {
    const initial = await joinVenueWaitlist("user_1", {
      venueId: "venue_1",
      date: "2026-12-01",
      time: "10:00",
    });

    const entry = mockWaitlist.find((w: any) => w.id === initial.entry.id);
    entry.status = "CANCELLED";

    const rejoin = await joinVenueWaitlist("user_1", {
      venueId: "venue_1",
      date: "2026-12-01",
      time: "10:00",
    });

    expect(rejoin.success).toBe(true);
    expect(rejoin.entry.id).not.toBe(initial.entry.id);
    expect(rejoin.message).toContain("Successfully joined waitlist!");
  });
});
