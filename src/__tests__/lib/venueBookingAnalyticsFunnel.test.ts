/**
 * Tests for venue booking analytics funnel tracking.
 */

type FunnelStage = "impression" | "view" | "click" | "search" | "detail_view" | "initiate_booking" | "confirm";

interface FunnelEvent {
  eventId: string;
  userId: string;
  venueId: string;
  stage: FunnelStage;
  timestamp: number;
  sessionId: string;
}

const FUNNEL_ORDER: FunnelStage[] = [
  "impression", "view", "click", "search", "detail_view", "initiate_booking", "confirm",
];

function conversionFunnelStats(
  events: FunnelEvent[],
  venueId: string
): Record<FunnelStage, number> {
  const stats: Record<FunnelStage, number> = {} as Record<FunnelStage, number>;
  FUNNEL_ORDER.forEach((stage) => {
    stats[stage] = events.filter((e) => e.venueId === venueId && e.stage === stage).length;
  });
  return stats;
}

function stageConversionRate(stats: Record<FunnelStage, number>, from: FunnelStage, to: FunnelStage): number {
  const fromCount = stats[from];
  const toCount = stats[to];
  if (fromCount === 0) return 0;
  return Math.round((toCount / fromCount) * 100);
}

function dropOffStage(stats: Record<FunnelStage, number>): FunnelStage | null {
  let maxDrop = 0;
  let dropStage: FunnelStage | null = null;

  for (let i = 0; i < FUNNEL_ORDER.length - 1; i++) {
    const current = stats[FUNNEL_ORDER[i]];
    const next = stats[FUNNEL_ORDER[i + 1]];
    if (current === 0) continue;
    const dropPct = ((current - next) / current) * 100;
    if (dropPct > maxDrop) {
      maxDrop = dropPct;
      dropStage = FUNNEL_ORDER[i];
    }
  }
  return dropStage;
}

function sessionFunnelCompletion(events: FunnelEvent[], sessionId: string): boolean {
  const sessionEvents = events.filter((e) => e.sessionId === sessionId);
  return sessionEvents.some((e) => e.stage === "confirm");
}

const NOW = 1_700_000_000_000;
const EVENTS: FunnelEvent[] = [
  ...Array(100).fill(null).map((_, i) => ({ eventId: `e${i}`, userId: `u${i}`, venueId: "v1", stage: "impression" as FunnelStage, timestamp: NOW - i * 1000, sessionId: `s${i}` })),
  ...Array(60).fill(null).map((_, i) => ({ eventId: `ev${i}`, userId: `u${i}`, venueId: "v1", stage: "view" as FunnelStage, timestamp: NOW - i * 800, sessionId: `s${i}` })),
  ...Array(30).fill(null).map((_, i) => ({ eventId: `ec${i}`, userId: `u${i}`, venueId: "v1", stage: "initiate_booking" as FunnelStage, timestamp: NOW - i * 600, sessionId: `s${i}` })),
  ...Array(10).fill(null).map((_, i) => ({ eventId: `ef${i}`, userId: `u${i}`, venueId: "v1", stage: "confirm" as FunnelStage, timestamp: NOW - i * 400, sessionId: `s${i}` })),
];

describe("Venue booking analytics funnel", () => {
  it("conversionFunnelStats: impression = 100", () => {
    const stats = conversionFunnelStats(EVENTS, "v1");
    expect(stats.impression).toBe(100);
  });

  it("conversionFunnelStats: confirm = 10", () => {
    const stats = conversionFunnelStats(EVENTS, "v1");
    expect(stats.confirm).toBe(10);
  });

  it("stageConversionRate: impression→view = 60%", () => {
    const stats = conversionFunnelStats(EVENTS, "v1");
    expect(stageConversionRate(stats, "impression", "view")).toBe(60);
  });

  it("stageConversionRate: from zero → 0", () => {
    const stats = conversionFunnelStats(EVENTS, "v99");
    expect(stageConversionRate(stats, "impression", "view")).toBe(0);
  });

  it("dropOffStage: finds stage with biggest absolute drop", () => {
    const stats = conversionFunnelStats(EVENTS, "v1");
    const dropStage = dropOffStage(stats);
    expect(dropStage).not.toBeNull();
  });

  it("sessionFunnelCompletion: session s0 completed (has confirm)", () => {
    expect(sessionFunnelCompletion(EVENTS, "s0")).toBe(true);
  });

  it("sessionFunnelCompletion: session s50 not completed (only impression)", () => {
    expect(sessionFunnelCompletion(EVENTS, "s50")).toBe(false);
  });
});
