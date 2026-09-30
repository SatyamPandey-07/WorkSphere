/**
 * Tests for ML-powered smart waitlist management.
 */

interface WaitlistEntry {
  userId: string;
  joinedAt: number;
  tier: string;
  previousCancellations: number;
  avgResponseHours: number;
  bookingFrequency: number;
}

interface WaitlistSlot {
  slotId: string;
  venueId: string;
  date: string;
  openedAt: number;
  filledAt: number | null;
}

function offerPriority(entry: WaitlistEntry, nowMs: number): number {
  const tierBonus = { basic: 0, silver: 15, gold: 25, platinum: 40 }[entry.tier] ?? 0;
  const waitHours = (nowMs - entry.joinedAt) / 3_600_000;
  const waitBonus = Math.min(waitHours * 0.5, 20);
  const reliabilityBonus = Math.max(0, 20 - entry.previousCancellations * 5);
  const frequencyBonus = Math.min(entry.bookingFrequency * 2, 15);
  return tierBonus + waitBonus + reliabilityBonus + frequencyBonus;
}

function rankWaitlist(entries: WaitlistEntry[], nowMs: number): WaitlistEntry[] {
  return [...entries].sort((a, b) => offerPriority(b, nowMs) - offerPriority(a, nowMs));
}

function slotFillTime(slot: WaitlistSlot): number | null {
  if (!slot.filledAt) return null;
  return slot.filledAt - slot.openedAt;
}

function avgFillTimeMs(slots: WaitlistSlot[]): number {
  const filled = slots.filter((s) => s.filledAt !== null);
  if (filled.length === 0) return 0;
  return Math.round(filled.reduce((s, slot) => s + (slot.filledAt! - slot.openedAt), 0) / filled.length);
}

function fillRate(slots: WaitlistSlot[]): number {
  if (slots.length === 0) return 0;
  return Math.round((slots.filter((s) => s.filledAt !== null).length / slots.length) * 100);
}

const NOW = 1_700_000_000_000;
const ENTRIES: WaitlistEntry[] = [
  { userId: "u1", joinedAt: NOW - 4 * 3600_000, tier: "gold",     previousCancellations: 0, avgResponseHours: 0.5, bookingFrequency: 5 },
  { userId: "u2", joinedAt: NOW - 6 * 3600_000, tier: "basic",    previousCancellations: 2, avgResponseHours: 3,   bookingFrequency: 1 },
  { userId: "u3", joinedAt: NOW - 2 * 3600_000, tier: "platinum", previousCancellations: 0, avgResponseHours: 0.25,bookingFrequency: 8 },
];

describe("Smart waitlist ML management", () => {
  it("offerPriority: platinum user gets higher priority than basic", () => {
    const p3 = offerPriority(ENTRIES[2], NOW);
    const p2 = offerPriority(ENTRIES[1], NOW);
    expect(p3).toBeGreaterThan(p2);
  });

  it("rankWaitlist: platinum first despite shorter wait", () => {
    const ranked = rankWaitlist(ENTRIES, NOW);
    expect(ranked[0].userId).toBe("u3");
  });

  it("rankWaitlist: immutable", () => {
    const original = ENTRIES.map((e) => e.userId);
    rankWaitlist(ENTRIES, NOW);
    expect(ENTRIES.map((e) => e.userId)).toEqual(original);
  });

  it("avgFillTimeMs: no filled slots → 0", () => {
    const emptySlots = [{ slotId: "s1", venueId: "v1", date: "2026-10-01", openedAt: NOW, filledAt: null }];
    expect(avgFillTimeMs(emptySlots)).toBe(0);
  });

  it("fillRate: 1 of 2 filled = 50%", () => {
    const slots = [
      { slotId: "s1", venueId: "v1", date: "2026-10-01", openedAt: NOW - 3600_000, filledAt: NOW - 1800_000 },
      { slotId: "s2", venueId: "v1", date: "2026-10-02", openedAt: NOW - 7200_000, filledAt: null },
    ];
    expect(fillRate(slots)).toBe(50);
  });
});
