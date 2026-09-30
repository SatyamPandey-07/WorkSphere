/**
 * Tests for user onboarding checklist step completion.
 */

type OnboardingStep =
  | "profile_completed"
  | "first_search"
  | "first_booking"
  | "app_downloaded"
  | "notifications_enabled";

interface OnboardingState {
  userId: string;
  completedSteps: OnboardingStep[];
  startedAt: number;
}

const ALL_STEPS: OnboardingStep[] = [
  "profile_completed",
  "first_search",
  "first_booking",
  "app_downloaded",
  "notifications_enabled",
];

function isStepCompleted(state: OnboardingState, step: OnboardingStep): boolean {
  return state.completedSteps.includes(step);
}

function completionPercent(state: OnboardingState): number {
  return Math.round((state.completedSteps.length / ALL_STEPS.length) * 100);
}

function completeStep(state: OnboardingState, step: OnboardingStep): OnboardingState {
  if (isStepCompleted(state, step)) return state;
  return { ...state, completedSteps: [...state.completedSteps, step] };
}

function nextStep(state: OnboardingState): OnboardingStep | null {
  return ALL_STEPS.find((s) => !isStepCompleted(state, s)) ?? null;
}

function isOnboardingComplete(state: OnboardingState): boolean {
  return state.completedSteps.length >= ALL_STEPS.length;
}

const NOW = 1_700_000_000_000;
const EMPTY_STATE: OnboardingState = { userId: "u1", completedSteps: [], startedAt: NOW };

describe("User onboarding checklist", () => {
  it("no steps completed initially", () => {
    expect(completionPercent(EMPTY_STATE)).toBe(0);
  });

  it("isStepCompleted: false for empty state", () => {
    expect(isStepCompleted(EMPTY_STATE, "first_booking")).toBe(false);
  });

  it("completeStep adds step", () => {
    const updated = completeStep(EMPTY_STATE, "profile_completed");
    expect(isStepCompleted(updated, "profile_completed")).toBe(true);
  });

  it("completeStep: no duplicate if already done", () => {
    const s1 = completeStep(EMPTY_STATE, "profile_completed");
    const s2 = completeStep(s1, "profile_completed");
    expect(s2.completedSteps).toHaveLength(1);
  });

  it("completionPercent: 1/5 = 20%", () => {
    const s = completeStep(EMPTY_STATE, "profile_completed");
    expect(completionPercent(s)).toBe(20);
  });

  it("nextStep returns first incomplete step", () => {
    expect(nextStep(EMPTY_STATE)).toBe("profile_completed");
  });

  it("nextStep: returns null when all done", () => {
    const full: OnboardingState = { ...EMPTY_STATE, completedSteps: [...ALL_STEPS] };
    expect(nextStep(full)).toBeNull();
  });

  it("isOnboardingComplete: false when steps remain", () => {
    expect(isOnboardingComplete(EMPTY_STATE)).toBe(false);
  });

  it("isOnboardingComplete: true when all done", () => {
    const full: OnboardingState = { ...EMPTY_STATE, completedSteps: [...ALL_STEPS] };
    expect(isOnboardingComplete(full)).toBe(true);
  });
});
