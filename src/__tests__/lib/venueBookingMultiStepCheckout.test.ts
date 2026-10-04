/**
 * Tests for multi-step booking checkout flow state management.
 */

type CheckoutStep = "venue_selection" | "date_time" | "details" | "add_ons" | "review" | "payment" | "confirmation";

interface CheckoutState {
  bookingId: string;
  currentStep: CheckoutStep;
  completedSteps: CheckoutStep[];
  data: Partial<{
    venueId: string;
    startMs: number;
    endMs: number;
    guestCount: number;
    selectedAddOns: string[];
    paymentMethod: string;
    promoCode: string;
  }>;
  errors: Record<string, string>;
  lastUpdatedAt: number;
}

const STEP_ORDER: CheckoutStep[] = [
  "venue_selection", "date_time", "details", "add_ons", "review", "payment", "confirmation"
];

function stepIndex(step: CheckoutStep): number {
  return STEP_ORDER.indexOf(step);
}

function canProceed(state: CheckoutState): boolean {
  return Object.keys(state.errors).length === 0;
}

function nextStep(state: CheckoutState): CheckoutStep | null {
  const idx = stepIndex(state.currentStep);
  return idx < STEP_ORDER.length - 1 ? STEP_ORDER[idx + 1] : null;
}

function previousStep(state: CheckoutState): CheckoutStep | null {
  const idx = stepIndex(state.currentStep);
  return idx > 0 ? STEP_ORDER[idx - 1] : null;
}

function checkoutProgress(state: CheckoutState): number {
  return Math.round((state.completedSteps.length / (STEP_ORDER.length - 1)) * 100);
}

function isStepCompleted(state: CheckoutState, step: CheckoutStep): boolean {
  return state.completedSteps.includes(step);
}

function isStepAccessible(state: CheckoutState, step: CheckoutStep): boolean {
  const targetIdx = stepIndex(step);
  const currentIdx = stepIndex(state.currentStep);
  return targetIdx <= currentIdx || state.completedSteps.includes(STEP_ORDER[targetIdx - 1]);
}

const STATE: CheckoutState = {
  bookingId: "bk-001", currentStep: "details",
  completedSteps: ["venue_selection", "date_time"],
  data: { venueId: "v1", startMs: 1_700_000_000_000, endMs: 1_700_014_400_000, guestCount: 50 },
  errors: {},
  lastUpdatedAt: 1_700_000_000_000,
};

describe("Multi-step checkout flow", () => {
  it("stepIndex: date_time is step 1", () => {
    expect(stepIndex("date_time")).toBe(1);
  });

  it("nextStep: after details → add_ons", () => {
    expect(nextStep(STATE)).toBe("add_ons");
  });

  it("previousStep: before details → date_time", () => {
    expect(previousStep(STATE)).toBe("date_time");
  });

  it("canProceed: no errors → true", () => {
    expect(canProceed(STATE)).toBe(true);
  });

  it("canProceed: with errors → false", () => {
    const withError = { ...STATE, errors: { guestCount: "Too many guests" } };
    expect(canProceed(withError)).toBe(false);
  });

  it("checkoutProgress: 2 of 6 steps done = 33%", () => {
    expect(checkoutProgress(STATE)).toBe(33);
  });

  it("isStepCompleted: venue_selection → true", () => {
    expect(isStepCompleted(STATE, "venue_selection")).toBe(true);
  });
});
