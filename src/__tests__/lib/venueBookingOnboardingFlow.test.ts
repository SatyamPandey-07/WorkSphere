/**
 * Tests for venue owner onboarding flow management.
 */

type OnboardingStep =
  | "account_created"
  | "venue_info_added"
  | "photos_uploaded"
  | "pricing_set"
  | "availability_configured"
  | "payment_setup"
  | "published";

interface OnboardingProgress {
  venueId: string;
  completedSteps: OnboardingStep[];
  skippedSteps: OnboardingStep[];
  startedAt: number;
  lastActivityAt: number;
  publishedAt: number | null;
}

const REQUIRED_STEPS: OnboardingStep[] = [
  "account_created", "venue_info_added", "pricing_set", "availability_configured", "payment_setup",
];

const OPTIONAL_STEPS: OnboardingStep[] = ["photos_uploaded"];

function onboardingProgressPct(progress: OnboardingProgress): number {
  const allSteps = [...REQUIRED_STEPS, ...OPTIONAL_STEPS];
  const completed = progress.completedSteps.filter((s) => allSteps.includes(s)).length;
  return Math.round((completed / allSteps.length) * 100);
}

function canPublish(progress: OnboardingProgress): boolean {
  return REQUIRED_STEPS.every((s) =>
    progress.completedSteps.includes(s) || progress.skippedSteps.includes(s)
  );
}

function nextRequiredStep(progress: OnboardingProgress): OnboardingStep | null {
  return REQUIRED_STEPS.find(
    (s) => !progress.completedSteps.includes(s) && !progress.skippedSteps.includes(s)
  ) ?? null;
}

function completeStep(progress: OnboardingProgress, step: OnboardingStep, nowMs: number): OnboardingProgress {
  if (progress.completedSteps.includes(step)) return progress;
  return {
    ...progress,
    completedSteps: [...progress.completedSteps, step],
    lastActivityAt: nowMs,
    publishedAt: step === "published" ? nowMs : progress.publishedAt,
  };
}

const NOW = 1_700_000_000_000;
const PROGRESS: OnboardingProgress = {
  venueId: "v1",
  completedSteps: ["account_created", "venue_info_added", "photos_uploaded"],
  skippedSteps: [],
  startedAt: NOW - 86_400_000,
  lastActivityAt: NOW - 3600_000,
  publishedAt: null,
};

describe("Venue owner onboarding flow", () => {
  it("onboardingProgressPct: 3/6 = 50%", () => {
    expect(onboardingProgressPct(PROGRESS)).toBe(50);
  });

  it("canPublish: missing required steps → false", () => {
    expect(canPublish(PROGRESS)).toBe(false);
  });

  it("canPublish: all required complete → true", () => {
    const complete = {
      ...PROGRESS,
      completedSteps: [...REQUIRED_STEPS, "photos_uploaded"],
    };
    expect(canPublish(complete)).toBe(true);
  });

  it("nextRequiredStep: pricing_set is next required", () => {
    expect(nextRequiredStep(PROGRESS)).toBe("pricing_set");
  });

  it("nextRequiredStep: all required done → null", () => {
    const allDone = { ...PROGRESS, completedSteps: [...REQUIRED_STEPS, "photos_uploaded"] };
    expect(nextRequiredStep(allDone)).toBeNull();
  });

  it("completeStep: adds step to completed", () => {
    const updated = completeStep(PROGRESS, "pricing_set", NOW);
    expect(updated.completedSteps).toContain("pricing_set");
    expect(updated.lastActivityAt).toBe(NOW);
  });

  it("completeStep: idempotent", () => {
    const updated = completeStep(PROGRESS, "account_created", NOW);
    expect(updated.completedSteps.filter((s) => s === "account_created")).toHaveLength(1);
  });
});
