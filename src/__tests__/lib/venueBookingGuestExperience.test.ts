/**
 * Tests for venue guest experience touchpoint management.
 */

type TouchpointType = "pre_arrival" | "check_in" | "during_stay" | "check_out" | "post_stay";

interface ExperienceTouchpoint {
  touchpointId: string;
  type: TouchpointType;
  title: string;
  triggeredAtMs: number;
  completedAt: number | null;
  guestSatisfaction: number | null;  // 1-5 post-completion
  automatable: boolean;
}

function pendingTouchpoints(
  touchpoints: ExperienceTouchpoint[],
  nowMs: number,
  bufferMs = 30 * 60_000
): ExperienceTouchpoint[] {
  return touchpoints.filter(
    (t) => t.completedAt === null && t.triggeredAtMs <= nowMs + bufferMs
  );
}

function completeTouch(tp: ExperienceTouchpoint, satisfaction: number | null, nowMs: number): ExperienceTouchpoint {
  return { ...tp, completedAt: nowMs, guestSatisfaction: satisfaction };
}

function touchpointCompletionRate(touchpoints: ExperienceTouchpoint[]): number {
  if (touchpoints.length === 0) return 0;
  const completed = touchpoints.filter((t) => t.completedAt !== null).length;
  return Math.round((completed / touchpoints.length) * 100);
}

function avgGuestSatisfaction(touchpoints: ExperienceTouchpoint[]): number {
  const rated = touchpoints.filter((t) => t.guestSatisfaction !== null);
  if (rated.length === 0) return 0;
  return Math.round((rated.reduce((s, t) => s + (t.guestSatisfaction ?? 0), 0) / rated.length) * 10) / 10;
}

function automatedCompleteAll(
  touchpoints: ExperienceTouchpoint[],
  nowMs: number
): ExperienceTouchpoint[] {
  return touchpoints.map((t) =>
    t.automatable && t.completedAt === null
      ? completeTouch(t, null, nowMs)
      : t
  );
}

const NOW = 1_700_000_000_000;
const TOUCHPOINTS: ExperienceTouchpoint[] = [
  { touchpointId: "t1", type: "pre_arrival",  title: "Send directions",   triggeredAtMs: NOW - 3000,     completedAt: null,     guestSatisfaction: null, automatable: true  },
  { touchpointId: "t2", type: "check_in",     title: "Welcome message",   triggeredAtMs: NOW - 1000,     completedAt: null,     guestSatisfaction: null, automatable: true  },
  { touchpointId: "t3", type: "post_stay",    title: "Request review",    triggeredAtMs: NOW + 3600_000, completedAt: null,     guestSatisfaction: null, automatable: true  },
  { touchpointId: "t4", type: "during_stay",  title: "Check-in question", triggeredAtMs: NOW - 500,      completedAt: NOW - 100,guestSatisfaction: 4,    automatable: false },
];

describe("Venue guest experience touchpoints", () => {
  it("pendingTouchpoints: t1, t2, t4 due (t4 already completed)", () => {
    const pending = pendingTouchpoints(TOUCHPOINTS, NOW);
    const pendingIds = pending.map((t) => t.touchpointId);
    expect(pendingIds).toContain("t1");
    expect(pendingIds).toContain("t2");
    expect(pendingIds).not.toContain("t4"); // completed
  });

  it("touchpointCompletionRate: 1/4 = 25%", () => {
    expect(touchpointCompletionRate(TOUCHPOINTS)).toBe(25);
  });

  it("avgGuestSatisfaction: only t4 rated = 4.0", () => {
    expect(avgGuestSatisfaction(TOUCHPOINTS)).toBe(4);
  });

  it("automatedCompleteAll: marks automatable pending as completed", () => {
    const updated = automatedCompleteAll(TOUCHPOINTS, NOW);
    const autoCompleted = updated.filter((t) => t.automatable && t.completedAt !== null);
    expect(autoCompleted.length).toBeGreaterThan(1);
  });

  it("automatedCompleteAll: non-automatable unchanged", () => {
    // t4 is non-automatable, already completed - not changed
    const updated = automatedCompleteAll(TOUCHPOINTS, NOW);
    expect(updated.find((t) => t.touchpointId === "t4")!.completedAt).toBe(NOW - 100);
  });
});
