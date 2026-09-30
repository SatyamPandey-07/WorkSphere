/**
 * Tests for venue booking dispute resolution workflows.
 */

type DisputeReason = "no_show" | "damage" | "overbooking" | "quality" | "billing" | "cancellation";
type DisputeStatus = "open" | "investigating" | "mediation" | "resolved_guest" | "resolved_venue" | "escalated";

interface Dispute {
  id: string;
  bookingId: string;
  reason: DisputeReason;
  status: DisputeStatus;
  claimedAmount: number;
  openedAt: number;
  resolvedAt: number | null;
  escalated: boolean;
}

const SLA_HOURS: Record<DisputeReason, number> = {
  no_show: 24, damage: 72, overbooking: 12, quality: 48, billing: 48, cancellation: 24,
};

function disputeAge(dispute: Dispute, nowMs: number): number {
  return Math.floor((nowMs - dispute.openedAt) / 3_600_000);
}

function isSlaBreach(dispute: Dispute, nowMs: number): boolean {
  if (dispute.resolvedAt) return false;
  const ageHours = disputeAge(dispute, nowMs);
  return ageHours > SLA_HOURS[dispute.reason];
}

function resolutionTime(dispute: Dispute): number | null {
  if (!dispute.resolvedAt) return null;
  return Math.floor((dispute.resolvedAt - dispute.openedAt) / 3_600_000);
}

function avgResolutionHours(disputes: Dispute[]): number {
  const resolved = disputes.filter((d) => d.resolvedAt !== null);
  if (resolved.length === 0) return 0;
  return Math.round(resolved.reduce((s, d) => s + resolutionTime(d)!, 0) / resolved.length);
}

function escalationRate(disputes: Dispute[]): number {
  if (disputes.length === 0) return 0;
  return Math.round((disputes.filter((d) => d.escalated).length / disputes.length) * 100);
}

function totalClaimedByReason(disputes: Dispute[]): Record<DisputeReason, number> {
  const result = {} as Record<DisputeReason, number>;
  for (const d of disputes) {
    result[d.reason] = (result[d.reason] ?? 0) + d.claimedAmount;
  }
  return result;
}

const NOW = 1_700_000_000_000;
const DISPUTES: Dispute[] = [
  { id: "d1", bookingId: "b1", reason: "no_show",    status: "resolved_guest", claimedAmount: 200, openedAt: NOW - 20 * 3600_000, resolvedAt: NOW - 5 * 3600_000, escalated: false },
  { id: "d2", bookingId: "b2", reason: "overbooking", status: "investigating", claimedAmount: 500, openedAt: NOW - 15 * 3600_000, resolvedAt: null, escalated: true },
  { id: "d3", bookingId: "b3", reason: "billing",    status: "resolved_venue", claimedAmount: 100, openedAt: NOW - 72 * 3600_000, resolvedAt: NOW - 24 * 3600_000, escalated: false },
];

describe("Dispute resolution workflows", () => {
  it("disputeAge: d1 opened 20h ago", () => {
    expect(disputeAge(DISPUTES[0], NOW)).toBe(20);
  });

  it("isSlaBreach: overbooking after 15h → breach (SLA=12h)", () => {
    expect(isSlaBreach(DISPUTES[1], NOW)).toBe(true);
  });

  it("isSlaBreach: resolved dispute → false", () => {
    expect(isSlaBreach(DISPUTES[0], NOW)).toBe(false);
  });

  it("resolutionTime: d1 = 15h", () => {
    expect(resolutionTime(DISPUTES[0])).toBe(15);
  });

  it("avgResolutionHours: average of d1(15h) and d3(48h) = 32h", () => {
    expect(avgResolutionHours(DISPUTES)).toBe(32);
  });

  it("escalationRate: 1 of 3 = 33%", () => {
    expect(escalationRate(DISPUTES)).toBe(33);
  });
});
