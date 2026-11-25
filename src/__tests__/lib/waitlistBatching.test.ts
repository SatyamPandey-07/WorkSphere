import { getUserWaitlistEntries } from "@/lib/waitlist/waitlistService";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/notifications/dispatcher", () => ({
  NotificationDispatcher: class {
    async dispatch() {}
  },
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venueSeatWaitlist: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  },
}));

describe("Waitlist Retrieval Query Batching (#9856)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns empty array with a single query when user has no entries", async () => {
    (prisma.venueSeatWaitlist.findMany as jest.Mock).mockResolvedValueOnce([]);

    const result = await getUserWaitlistEntries("user-empty");

    expect(result).toEqual([]);
    expect(prisma.venueSeatWaitlist.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.venueSeatWaitlist.count).not.toHaveBeenCalled();
  });

  it("batches queue position and total calculations across multiple entries in exactly 2 queries", async () => {
    const time1 = new Date("2026-11-24T10:00:00Z");
    const time2 = new Date("2026-11-24T10:05:00Z");
    const time3 = new Date("2026-11-24T11:00:00Z");

    const userEntries = [
      {
        id: "entry-u1",
        userId: "user-active",
        venueId: "v-1",
        seatId: "s-1",
        seatType: "DESK",
        date: "2026-11-25",
        time: "14:00",
        duration: 60,
        timeZone: "UTC",
        requiresQuiet: false,
        requiresOutlets: true,
        status: "ACTIVE",
        notifiedAt: null,
        claimExpiresAt: null,
        claimedAt: null,
        createdAt: time2, // Joined at 10:05 (second in line)
        updatedAt: time2,
        venue: { name: "Tokyo Central Work" },
        seat: { seatNumber: "D-12" },
      },
      {
        id: "entry-u2",
        userId: "user-active",
        venueId: "v-2",
        seatId: null,
        seatType: "BOOTH",
        date: "2026-11-26",
        time: "10:00",
        duration: 120,
        timeZone: "UTC",
        requiresQuiet: true,
        requiresOutlets: false,
        status: "NOTIFIED",
        notifiedAt: new Date("2026-11-24T11:30:00Z"),
        claimExpiresAt: new Date("2026-11-24T11:45:00Z"),
        claimedAt: null,
        createdAt: time3, // Only one in queue
        updatedAt: time3,
        venue: { name: "Shibuya Silent Hub" },
        seat: null,
      },
    ];

    // Query 1: fetch user entries
    (prisma.venueSeatWaitlist.findMany as jest.Mock).mockResolvedValueOnce(
      userEntries,
    );

    // All active/notified entries in those 2 queues
    const batchedQueueItems = [
      // Queue 1 (v-1, 2026-11-25, 14:00) has 3 people:
      {
        id: "other-earlier",
        venueId: "v-1",
        date: "2026-11-25",
        time: "14:00",
        createdAt: time1, // Joined at 10:00 (#1)
      },
      {
        id: "entry-u1",
        venueId: "v-1",
        date: "2026-11-25",
        time: "14:00",
        createdAt: time2, // Joined at 10:05 (#2)
      },
      {
        id: "other-later",
        venueId: "v-1",
        date: "2026-11-25",
        time: "14:00",
        createdAt: new Date("2026-11-24T10:10:00Z"), // Joined at 10:10 (#3)
      },
      // Queue 2 (v-2, 2026-11-26, 10:00) has 1 person:
      {
        id: "entry-u2",
        venueId: "v-2",
        date: "2026-11-26",
        time: "10:00",
        createdAt: time3, // Joined at 11:00 (#1)
      },
    ];

    // Query 2: batch fetch for queues
    (prisma.venueSeatWaitlist.findMany as jest.Mock).mockResolvedValueOnce(
      batchedQueueItems,
    );

    const results = await getUserWaitlistEntries("user-active");

    // Exactly 2 findMany queries executed and zero count queries!
    expect(prisma.venueSeatWaitlist.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.venueSeatWaitlist.count).not.toHaveBeenCalled();

    expect(results).toHaveLength(2);

    // Entry 1: queuePosition = 2, totalInQueue = 3
    expect(results[0].id).toBe("entry-u1");
    expect(results[0].queuePosition).toBe(2);
    expect(results[0].totalInQueue).toBe(3);
    expect(results[0].venueName).toBe("Tokyo Central Work");
    expect(results[0].seatNumber).toBe("D-12");

    // Entry 2: queuePosition = 1, totalInQueue = 1
    expect(results[1].id).toBe("entry-u2");
    expect(results[1].queuePosition).toBe(1);
    expect(results[1].totalInQueue).toBe(1);
    expect(results[1].venueName).toBe("Shibuya Silent Hub");
    expect(results[1].status).toBe("NOTIFIED");
  });

  it("filters by venueId when provided", async () => {
    (prisma.venueSeatWaitlist.findMany as jest.Mock).mockResolvedValueOnce([]);

    await getUserWaitlistEntries("user-filtered", "v-target");

    expect(prisma.venueSeatWaitlist.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-filtered",
          venueId: "v-target",
          status: { in: ["ACTIVE", "NOTIFIED"] },
        }),
      }),
    );
  });
});
