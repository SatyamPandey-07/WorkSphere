/**
 * Tests for venue booking waitlist priority queue management.
 */

interface WaitlistEntry2 {
  userId: string;
  venueId: string;
  slotDate: string;
  joinedAt: number;
  tier: "standard" | "premium" | "vip";
  flexibleDates: boolean;
  previousNoShows: number;
}

type PriorityScore = number;

const TIER_POINTS: Record<WaitlistEntry2["tier"], number> = {
  standard: 0, premium: 20, vip: 40,
};

function waitTimeHours(entry: WaitlistEntry2, nowMs: number): number {
  return Math.floor((nowMs - entry.joinedAt) / 3_600_000);
}

function priorityScore(entry: WaitlistEntry2, nowMs: number): PriorityScore {
  const tierBonus    = TIER_POINTS[entry.tier];
  const waitBonus    = Math.min(waitTimeHours(entry, nowMs) * 0.5, 30);
  const flexBonus    = entry.flexibleDates ? 10 : 0;
  const noShowPenalty= entry.previousNoShows * 10;
  return Math.round(tierBonus + waitBonus + flexBonus - noShowPenalty);
}

function sortedQueue(entries: WaitlistEntry2[], nowMs: number): WaitlistEntry2[] {
  return [...entries].sort((a, b) => priorityScore(b, nowMs) - priorityScore(a, nowMs));
}

function eligibleForOffer(entry: WaitlistEntry2): boolean {
  return entry.previousNoShows < 2;
}

function queuePosition(
  entries: WaitlistEntry2[],
  userId: string,
  nowMs: number
): number {
  const sorted = sortedQueue(entries, nowMs);
  const idx = sorted.findIndex((e) => e.userId === userId);
  return idx === -1 ? -1 : idx + 1;
}

const NOW = 1_700_000_000_000;
const QUEUE: WaitlistEntry2[] = [
  { userId: "u1", venueId: "v1", slotDate: "2026-11-01", joinedAt: NOW - 4 * 3600_000, tier: "vip",      flexibleDates: true,  previousNoShows: 0 },
  { userId: "u2", venueId: "v1", slotDate: "2026-11-01", joinedAt: NOW - 8 * 3600_000, tier: "standard", flexibleDates: false, previousNoShows: 1 },
  { userId: "u3", venueId: "v1", slotDate: "2026-11-01", joinedAt: NOW - 6 * 3600_000, tier: "premium",  flexibleDates: true,  previousNoShows: 0 },
];

describe("Waitlist priority queue", () => {
  it("priorityScore: VIP with flexible dates scores highest", () => {
    const scores = QUEUE.map((e) => priorityScore(e, NOW));
    expect(scores[0]).toBeGreaterThan(scores[1]);
  });

  it("sortedQueue: u1 (VIP) at position 1", () => {
    expect(queuePosition(QUEUE, "u1", NOW)).toBe(1);
  });

  it("eligibleForOffer: 0 no-shows → eligible", () => {
    expect(eligibleForOffer(QUEUE[0])).toBe(true);
  });

  it("eligibleForOffer: 2+ no-shows → ineligible", () => {
    const badActor = { ...QUEUE[1], previousNoShows: 2 };
    expect(eligibleForOffer(badActor)).toBe(false);
  });

  it("sortedQueue: immutable", () => {
    const ids = QUEUE.map((e) => e.userId);
    sortedQueue(QUEUE, NOW);
    expect(QUEUE.map((e) => e.userId)).toEqual(ids);
  });

  it("queuePosition: unknown user → -1", () => {
    expect(queuePosition(QUEUE, "unknown", NOW)).toBe(-1);
  });
});
