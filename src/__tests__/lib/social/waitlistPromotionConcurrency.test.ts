import { autoPromoteSessionWaitlist } from "@/lib/social/waitlistPromotion";
import { prisma } from "@/lib/prisma";
import { eventBus } from "@/core/events";

jest.mock("@/core/events", () => ({
  eventBus: {
    emit: jest.fn().mockResolvedValue(undefined),
  },
}));

describe("autoPromoteSessionWaitlist - Concurrency & Duplicate Prevention (#5036)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("wraps promotion sweep in interactive transaction with serializable isolation", async () => {
    const mockSession = {
      id: "session-1",
      maxGuests: 5,
      _count: { rsvps: 3 },
    };

    const mockWaitlist = [
      { id: "rsvp-1", userId: "user-1", sessionId: "session-1", status: "MAYBE" },
      { id: "rsvp-2", userId: "user-2", sessionId: "session-1", status: "MAYBE" },
    ];

    const txMock: any = {
      coworkingSession: {
        findUnique: jest.fn().mockResolvedValue(mockSession),
      },
      sessionRsvp: {
        findMany: jest.fn().mockResolvedValue(mockWaitlist),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    (prisma.$transaction as unknown as jest.Mock) = jest
      .fn()
      .mockImplementation(async (callback: any, options: any) => {
        expect(options?.isolationLevel).toBeDefined();
        return callback(txMock);
      });

    const result = await autoPromoteSessionWaitlist("session-1");

    expect(result.promotedCount).toBe(2);
    expect(result.promotedRsvps).toHaveLength(2);
    expect(eventBus.emit).toHaveBeenCalledWith("session:promoted", expect.objectContaining({
      sessionId: "session-1",
      rsvpId: "rsvp-1",
    }));
  });

  it("prevents duplicate promotions if concurrent sweeps process the same attendee (atomic CAS)", async () => {
    const mockSession = {
      id: "session-1",
      maxGuests: 10,
      _count: { rsvps: 4 },
    };

    const mockWaitlist = [
      { id: "rsvp-1", userId: "user-1", sessionId: "session-1", status: "MAYBE" },
    ];

    let updateCount = 1;

    const txMock: any = {
      coworkingSession: {
        findUnique: jest.fn().mockResolvedValue(mockSession),
      },
      sessionRsvp: {
        findMany: jest.fn().mockResolvedValue(mockWaitlist),
        updateMany: jest.fn().mockImplementation(() => {
          const count = updateCount;
          updateCount = 0; // next concurrent call sees 0 rows updated
          return Promise.resolve({ count });
        }),
      },
    };

    (prisma.$transaction as unknown as jest.Mock) = jest
      .fn()
      .mockImplementation(async (callback: any) => callback(txMock));

    // Simulate 2 simultaneous sweeps triggered by rapid capacity changes
    const [sweep1, sweep2] = await Promise.all([
      autoPromoteSessionWaitlist("session-1"),
      autoPromoteSessionWaitlist("session-1"),
    ]);

    const totalPromoted = sweep1.promotedCount + sweep2.promotedCount;
    expect(totalPromoted).toBe(1);

    // Only one sweep should have successfully promoted the user
    expect(
      (sweep1.promotedCount === 1 && sweep2.promotedCount === 0) ||
      (sweep1.promotedCount === 0 && sweep2.promotedCount === 1),
    ).toBe(true);
  });

  it("returns 0 promotions when no capacity is available", async () => {
    const mockSession = {
      id: "session-1",
      maxGuests: 5,
      _count: { rsvps: 5 }, // Full capacity
    };

    const txMock: any = {
      coworkingSession: {
        findUnique: jest.fn().mockResolvedValue(mockSession),
      },
      sessionRsvp: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    (prisma.$transaction as unknown as jest.Mock) = jest
      .fn()
      .mockImplementation(async (callback: any) => callback(txMock));

    const result = await autoPromoteSessionWaitlist("session-1");
    expect(result.promotedCount).toBe(0);
    expect(txMock.sessionRsvp.findMany).not.toHaveBeenCalled();
  });
});
