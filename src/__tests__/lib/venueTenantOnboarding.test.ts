/**
 * Tests for venue tenant (resident member) onboarding workflow.
 */

type OnboardingStage =
  | "application"
  | "document_review"
  | "payment_setup"
  | "access_provisioned"
  | "active"
  | "rejected";

interface TenantApplication {
  applicationId: string;
  userId: string;
  venueId: string;
  stage: OnboardingStage;
  submittedAt: number;
  reviewedAt?: number;
  startDate?: string;
  monthlyRentCents: number;
  documentsVerified: boolean;
}

const STAGE_ORDER: OnboardingStage[] = [
  "application", "document_review", "payment_setup",
  "access_provisioned", "active",
];

function advanceStage(
  app: TenantApplication
): TenantApplication {
  const idx = STAGE_ORDER.indexOf(app.stage);
  if (idx === -1 || idx === STAGE_ORDER.length - 1) return app;
  return { ...app, stage: STAGE_ORDER[idx + 1] };
}

function canAdvance(app: TenantApplication): boolean {
  if (app.stage === "active" || app.stage === "rejected") return false;
  if (app.stage === "document_review" && !app.documentsVerified) return false;
  return true;
}

function rejectApplication(
  app: TenantApplication,
  nowMs: number
): TenantApplication {
  return { ...app, stage: "rejected", reviewedAt: nowMs };
}

function isOnboarded(app: TenantApplication): boolean {
  return app.stage === "active";
}

const NOW = 1_700_000_000_000;
const APP: TenantApplication = {
  applicationId: "ta1", userId: "u1", venueId: "v1",
  stage: "document_review", submittedAt: NOW - 86_400_000,
  monthlyRentCents: 50_000, documentsVerified: false,
};

describe("Venue tenant onboarding", () => {
  it("advanceStage: document_review → payment_setup", () => {
    expect(advanceStage(APP).stage).toBe("payment_setup");
  });

  it("advanceStage: active → no change", () => {
    const active = { ...APP, stage: "active" as OnboardingStage };
    expect(advanceStage(active).stage).toBe("active");
  });

  it("canAdvance: document_review without verification → false", () => {
    expect(canAdvance(APP)).toBe(false);
  });

  it("canAdvance: document_review with verification → true", () => {
    expect(canAdvance({ ...APP, documentsVerified: true })).toBe(true);
  });

  it("canAdvance: active → false", () => {
    expect(canAdvance({ ...APP, stage: "active" })).toBe(false);
  });

  it("canAdvance: rejected → false", () => {
    expect(canAdvance({ ...APP, stage: "rejected" })).toBe(false);
  });

  it("rejectApplication: sets stage and reviewedAt", () => {
    const rejected = rejectApplication(APP, NOW);
    expect(rejected.stage).toBe("rejected");
    expect(rejected.reviewedAt).toBe(NOW);
  });

  it("isOnboarded: active → true", () => {
    expect(isOnboarded({ ...APP, stage: "active" })).toBe(true);
  });

  it("isOnboarded: in progress → false", () => {
    expect(isOnboarded(APP)).toBe(false);
  });
});
