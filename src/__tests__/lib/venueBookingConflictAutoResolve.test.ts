/**
 * Tests for automatic conflict resolution when double-bookings are detected.
 */

interface ConflictResolutionPolicy {
  strategy: "priority" | "fifo" | "revenue";
  notifyLoser: boolean;
  offerAlternative: boolean;
  compensationPct: number;  // % refund to losing party
}

interface ConflictingPair {
  bookingA: { bookingId: string; userId: string; submittedAt: number; priceCents: number; memberTier: string };
  bookingB: { bookingId: string; userId: string; submittedAt: number; priceCents: number; memberTier: string };
}

function resolveConflict(
  conflict: ConflictingPair,
  policy: ConflictResolutionPolicy
): { winner: string; loser: string } {
  const { bookingA, bookingB } = conflict;

  switch (policy.strategy) {
    case "fifo":
      return bookingA.submittedAt <= bookingB.submittedAt
        ? { winner: bookingA.bookingId, loser: bookingB.bookingId }
        : { winner: bookingB.bookingId, loser: bookingA.bookingId };

    case "revenue":
      return bookingA.priceCents >= bookingB.priceCents
        ? { winner: bookingA.bookingId, loser: bookingB.bookingId }
        : { winner: bookingB.bookingId, loser: bookingA.bookingId };

    case "priority": {
      const tierOrder = ["basic", "silver", "gold", "platinum"];
      const tierA = tierOrder.indexOf(bookingA.memberTier);
      const tierB = tierOrder.indexOf(bookingB.memberTier);
      if (tierA !== tierB) {
        return tierA > tierB
          ? { winner: bookingA.bookingId, loser: bookingB.bookingId }
          : { winner: bookingB.bookingId, loser: bookingA.bookingId };
      }
      // Tie: fall back to FIFO
      return bookingA.submittedAt <= bookingB.submittedAt
        ? { winner: bookingA.bookingId, loser: bookingB.bookingId }
        : { winner: bookingB.bookingId, loser: bookingA.bookingId };
    }
  }
}

function compensationAmount(loserPriceCents: number, policy: ConflictResolutionPolicy): number {
  return Math.round(loserPriceCents * (policy.compensationPct / 100));
}

const CONFLICT: ConflictingPair = {
  bookingA: { bookingId: "bA", userId: "u1", submittedAt: 1000, priceCents: 2000, memberTier: "gold" },
  bookingB: { bookingId: "bB", userId: "u2", submittedAt: 2000, priceCents: 3000, memberTier: "basic" },
};

describe("Booking conflict auto-resolution", () => {
  it("resolveConflict FIFO: bA submitted first → bA wins", () => {
    const { winner } = resolveConflict(CONFLICT, { strategy: "fifo", notifyLoser: true, offerAlternative: true, compensationPct: 100 });
    expect(winner).toBe("bA");
  });

  it("resolveConflict revenue: bB higher price → bB wins", () => {
    const { winner } = resolveConflict(CONFLICT, { strategy: "revenue", notifyLoser: true, offerAlternative: true, compensationPct: 100 });
    expect(winner).toBe("bB");
  });

  it("resolveConflict priority: bA gold > bB basic → bA wins", () => {
    const { winner } = resolveConflict(CONFLICT, { strategy: "priority", notifyLoser: true, offerAlternative: true, compensationPct: 100 });
    expect(winner).toBe("bA");
  });

  it("resolveConflict priority same tier: falls back to FIFO", () => {
    const sameTier: ConflictingPair = {
      bookingA: { ...CONFLICT.bookingA, memberTier: "silver" },
      bookingB: { ...CONFLICT.bookingB, memberTier: "silver" },
    };
    const { winner } = resolveConflict(sameTier, { strategy: "priority", notifyLoser: true, offerAlternative: true, compensationPct: 100 });
    expect(winner).toBe("bA"); // earlier submission
  });

  it("compensationAmount: 100% refund on 3000 = 3000", () => {
    const policy = { strategy: "fifo" as const, notifyLoser: true, offerAlternative: true, compensationPct: 100 };
    expect(compensationAmount(3000, policy)).toBe(3000);
  });

  it("compensationAmount: 50% refund = 1500", () => {
    const policy = { strategy: "fifo" as const, notifyLoser: true, offerAlternative: true, compensationPct: 50 };
    expect(compensationAmount(3000, policy)).toBe(1500);
  });
});
