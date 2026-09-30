/**
 * Tests for booking payment escrow management.
 */

type EscrowStatus = "held" | "released_to_venue" | "refunded_to_user" | "disputed";

interface EscrowAccount {
  escrowId: string;
  bookingId: string;
  userId: string;
  venueId: string;
  amountCents: number;
  status: EscrowStatus;
  heldAt: number;
  releaseAfterMs: number;  // release to venue after this many ms from booking end
  releasedAt: number | null;
  bookingEndMs: number;
}

function canRelease(escrow: EscrowAccount, nowMs: number): boolean {
  if (escrow.status !== "held") return false;
  return nowMs >= escrow.bookingEndMs + escrow.releaseAfterMs;
}

function releaseToVenue(escrow: EscrowAccount, nowMs: number): EscrowAccount {
  if (!canRelease(escrow, nowMs)) throw new Error("Cannot release escrow yet");
  return { ...escrow, status: "released_to_venue", releasedAt: nowMs };
}

function refundToUser(escrow: EscrowAccount, nowMs: number): EscrowAccount {
  if (escrow.status !== "held") throw new Error("Escrow not held");
  return { ...escrow, status: "refunded_to_user", releasedAt: nowMs };
}

function escalateToDispute(escrow: EscrowAccount): EscrowAccount {
  if (escrow.status === "disputed") return escrow; // already disputed
  return { ...escrow, status: "disputed" };
}

function escrowHoldDurationMs(escrow: EscrowAccount, nowMs: number): number {
  if (!escrow.releasedAt) return nowMs - escrow.heldAt;
  return escrow.releasedAt - escrow.heldAt;
}

const NOW = 1_700_000_000_000;
const ESCROW: EscrowAccount = {
  escrowId: "es1", bookingId: "b1", userId: "u1", venueId: "v1",
  amountCents: 10_000,
  status: "held",
  heldAt: NOW - 7 * 86_400_000,
  releaseAfterMs: 3 * 86_400_000,  // 3 days after booking end
  releasedAt: null,
  bookingEndMs: NOW - 5 * 86_400_000,  // ended 5 days ago
};

describe("Booking payment escrow", () => {
  it("canRelease: 5d since end, 3d wait → true", () => {
    expect(canRelease(ESCROW, NOW)).toBe(true);
  });

  it("canRelease: only 1d since end, 3d wait → false", () => {
    const recent = { ...ESCROW, bookingEndMs: NOW - 1 * 86_400_000 };
    expect(canRelease(recent, NOW)).toBe(false);
  });

  it("canRelease: already released → false", () => {
    expect(canRelease({ ...ESCROW, status: "released_to_venue" }, NOW)).toBe(false);
  });

  it("releaseToVenue: sets status and releasedAt", () => {
    const released = releaseToVenue(ESCROW, NOW);
    expect(released.status).toBe("released_to_venue");
    expect(released.releasedAt).toBe(NOW);
  });

  it("releaseToVenue: throws if not ready", () => {
    const notReady = { ...ESCROW, bookingEndMs: NOW - 86_400_000 };
    expect(() => releaseToVenue(notReady, NOW)).toThrow("Cannot release");
  });

  it("refundToUser: sets refunded status", () => {
    const refunded = refundToUser(ESCROW, NOW);
    expect(refunded.status).toBe("refunded_to_user");
  });

  it("escalateToDispute: marks as disputed", () => {
    expect(escalateToDispute(ESCROW).status).toBe("disputed");
  });

  it("escrowHoldDurationMs: 7 days held", () => {
    expect(escrowHoldDurationMs(ESCROW, NOW)).toBe(7 * 86_400_000);
  });
});
