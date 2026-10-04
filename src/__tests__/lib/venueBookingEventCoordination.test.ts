/**
 * Tests for venue event coordination and run-of-show management.
 */

interface RunOfShowItem {
  id: string;
  title: string;
  startOffsetMinutes: number;  // minutes from event start
  durationMinutes: number;
  owner: string;
  status: "pending" | "in_progress" | "completed" | "delayed" | "skipped";
  notes: string;
}

interface EventCoordinationPlan {
  eventId: string;
  eventStartMs: number;
  runOfShow: RunOfShowItem[];
  coordinatorId: string;
}

function itemStartMs(plan: EventCoordinationPlan, item: RunOfShowItem): number {
  return plan.eventStartMs + item.startOffsetMinutes * 60_000;
}

function itemEndMs(plan: EventCoordinationPlan, item: RunOfShowItem): number {
  return itemStartMs(plan, item) + item.durationMinutes * 60_000;
}

function currentItem(plan: EventCoordinationPlan, nowMs: number): RunOfShowItem | null {
  return plan.runOfShow.find((item) =>
    itemStartMs(plan, item) <= nowMs && nowMs < itemEndMs(plan, item)
  ) ?? null;
}

function upcomingItems(plan: EventCoordinationPlan, nowMs: number, limit = 3): RunOfShowItem[] {
  return plan.runOfShow
    .filter((item) => itemStartMs(plan, item) > nowMs && item.status !== "skipped")
    .sort((a, b) => a.startOffsetMinutes - b.startOffsetMinutes)
    .slice(0, limit);
}

function completionPercent(plan: EventCoordinationPlan): number {
  if (plan.runOfShow.length === 0) return 0;
  const done = plan.runOfShow.filter((i) => i.status === "completed" || i.status === "skipped").length;
  return Math.round((done / plan.runOfShow.length) * 100);
}

function hasDelays(plan: EventCoordinationPlan): boolean {
  return plan.runOfShow.some((i) => i.status === "delayed");
}

const NOW = 1_700_000_000_000;
const PLAN: EventCoordinationPlan = {
  eventId: "e1", eventStartMs: NOW - 30 * 60_000, coordinatorId: "coord1",
  runOfShow: [
    { id: "r1", title: "Guest arrival",      startOffsetMinutes: 0,  durationMinutes: 30, owner: "host",    status: "completed",  notes: "" },
    { id: "r2", title: "Welcome speech",     startOffsetMinutes: 30, durationMinutes: 15, owner: "ceo",     status: "in_progress",notes: "" },
    { id: "r3", title: "Keynote",            startOffsetMinutes: 45, durationMinutes: 60, owner: "speaker", status: "pending",    notes: "" },
    { id: "r4", title: "Lunch break",        startOffsetMinutes: 105,durationMinutes: 45, owner: "catering",status: "pending",    notes: "" },
  ],
};

describe("Event coordination run-of-show management", () => {
  it("currentItem: welcome speech is running at 30min mark", () => {
    expect(currentItem(PLAN, NOW)?.id).toBe("r2");
  });

  it("upcomingItems: 2 upcoming after current (keynote + lunch)", () => {
    const upcoming = upcomingItems(PLAN, NOW);
    expect(upcoming[0].id).toBe("r3");
    expect(upcoming.length).toBe(2);
  });

  it("completionPercent: 1 of 4 = 25%", () => {
    expect(completionPercent(PLAN)).toBe(25);
  });

  it("hasDelays: no delayed items → false", () => {
    expect(hasDelays(PLAN)).toBe(false);
  });

  it("hasDelays: delayed item → true", () => {
    const withDelay = {
      ...PLAN,
      runOfShow: [...PLAN.runOfShow, { ...PLAN.runOfShow[3], id: "r5", status: "delayed" as const }],
    };
    expect(hasDelays(withDelay)).toBe(true);
  });

  it("itemEndMs: r1 ends 30 min after event start", () => {
    expect(itemEndMs(PLAN, PLAN.runOfShow[0])).toBe(PLAN.eventStartMs + 30 * 60_000);
  });
});
