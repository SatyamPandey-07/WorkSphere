/**
 * Tests for booking dispute management workflow.
 */

type DisputeReason = "no_show_venue" | "quality_issue" | "wrong_amenities" | "double_charge" | "other";
type DisputeStatus = "open" | "investigating" | "resolved_for_user" | "resolved_for_venue" | "closed";

interface BookingDispute {
  disputeId: string;
  bookingId: string;
  userId: string;
  reason: DisputeReason;
  description: string;
  status: DisputeStatus;
  filedAt: number;
  resolvedAt?: number;
  refundCents?: number;
}

function canEscalate(dispute: BookingDispute): boolean {
  return dispute.status === "open" || dispute.status === "investigating";
}

function isResolved(dispute: BookingDispute): boolean {
  return dispute.status === "resolved_for_user" ||
         dispute.status === "resolved_for_venue" ||
         dispute.status === "closed";
}

function resolveInFavorOfUser(
  dispute: BookingDispute,
  refundCents: number,
  nowMs: number
): BookingDispute {
  if (isResolved(dispute)) throw new Error("Dispute already resolved");
  return {
    ...dispute,
    status: "resolved_for_user",
    refundCents,
    resolvedAt: nowMs,
  };
}

function resolutionTime(dispute: BookingDispute): number | null {
  if (!dispute.resolvedAt) return null;
  return dispute.resolvedAt - dispute.filedAt;
}

const NOW = 1_700_000_000_000;
const DISPUTE: BookingDispute = {
  disputeId: "d1", bookingId: "b1", userId: "u1",
  reason: "quality_issue", description: "WiFi was broken.",
  status: "open", filedAt: NOW - 86_400_000,
};

describe("Booking dispute management", () => {
  it("canEscalate: open → true", () => {
    expect(canEscalate(DISPUTE)).toBe(true);
  });

  it("canEscalate: investigating → true", () => {
    expect(canEscalate({ ...DISPUTE, status: "investigating" })).toBe(true);
  });

  it("canEscalate: resolved → false", () => {
    expect(canEscalate({ ...DISPUTE, status: "resolved_for_user" })).toBe(false);
  });

  it("isResolved: open → false", () => {
    expect(isResolved(DISPUTE)).toBe(false);
  });

  it("isResolved: closed → true", () => {
    expect(isResolved({ ...DISPUTE, status: "closed" })).toBe(true);
  });

  it("resolveInFavorOfUser: sets status and refund", () => {
    const resolved = resolveInFavorOfUser(DISPUTE, 5000, NOW);
    expect(resolved.status).toBe("resolved_for_user");
    expect(resolved.refundCents).toBe(5000);
    expect(resolved.resolvedAt).toBe(NOW);
  });

  it("resolveInFavorOfUser: throws if already resolved", () => {
    const already = { ...DISPUTE, status: "resolved_for_venue" as DisputeStatus };
    expect(() => resolveInFavorOfUser(already, 0, NOW)).toThrow("already resolved");
  });

  it("resolutionTime: null for open dispute", () => {
    expect(resolutionTime(DISPUTE)).toBeNull();
  });

  it("resolutionTime: calculates time for resolved", () => {
    const resolved = resolveInFavorOfUser(DISPUTE, 5000, NOW);
    expect(resolutionTime(resolved)).toBe(86_400_000);
  });
});
