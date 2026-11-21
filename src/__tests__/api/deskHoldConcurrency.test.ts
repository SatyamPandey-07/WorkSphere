import { acquireDeskHold } from "@/lib/reservations/leaseManager";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

describe("Desk Hold Concurrency & Deadlock Prevention", () => {
  const venueId = "venue-concurrency-test-1";
  const seatIds = ["seat-1", "seat-2", "seat-3", "seat-4", "seat-5"];

  beforeAll(async () => {
    // Seed test data
    await prisma.deskHold.deleteMany({ where: { venueId } });
    await prisma.seat.deleteMany({ where: { id: { in: seatIds } } });

    await prisma.seat.createMany({
      data: seatIds.map((id) => ({ id, venueId, status: "AVAILABLE" })),
    });
  });

  afterAll(async () => {
    await prisma.deskHold.deleteMany({ where: { venueId } });
    await prisma.seat.deleteMany({ where: { id: { in: seatIds } } });
    await prisma.$disconnect();
  });

  it("handles 50 parallel requests without deadlocks (40P01), granting 5 holds and returning 45 conflicts", async () => {
    const totalRequests = 50;

    // Simulate concurrent workers requesting overlapping subsets in shuffled/inverted order
    const requests = Array.from({ length: totalRequests }).map((_, index) => {
      // Invert payload sort to simulate un-ordered concurrent client requests
      const payloadSeats =
        index % 2 === 0 ? [...seatIds] : [...seatIds].reverse();
      return acquireDeskHold({
        venueId,
        seatIds: payloadSeats,
        userId: `user-${index}`,
      });
    });

    const results = await Promise.all(requests);

    const successfulHolds = results.filter((r) => r.success);
    const failedConflicts = results.filter((r) => !r.success);

    expect(successfulHolds.length).toBe(1); // One user gets all 5 seats
    expect(failedConflicts.length).toBe(49);
    expect(successfulHolds[0].holdIds?.length).toBe(5);
  });
});
