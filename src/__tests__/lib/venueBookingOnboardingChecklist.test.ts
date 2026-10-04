/**
 * Tests for venue owner onboarding checklist management.
 */

interface ChecklistItem {
  id: string;
  title: string;
  category: "profile" | "listing" | "verification" | "banking" | "legal" | "settings";
  required: boolean;
  completedAt: number | null;
  order: number;
}

interface OnboardingProgress {
  venueId: string;
  ownerId: string;
  startedAt: number;
  items: ChecklistItem[];
}

function completedItems(progress: OnboardingProgress): ChecklistItem[] {
  return progress.items.filter((i) => i.completedAt !== null);
}

function pendingRequired(progress: OnboardingProgress): ChecklistItem[] {
  return progress.items.filter((i) => i.required && i.completedAt === null);
}

function completionPercent(progress: OnboardingProgress): number {
  if (progress.items.length === 0) return 0;
  return Math.round((completedItems(progress).length / progress.items.length) * 100);
}

function isEligibleToGo(progress: OnboardingProgress): boolean {
  return pendingRequired(progress).length === 0;
}

function nextStep(progress: OnboardingProgress): ChecklistItem | null {
  const pending = progress.items
    .filter((i) => i.completedAt === null)
    .sort((a, b) => a.order - b.order);
  return pending[0] ?? null;
}

function categoryProgress(progress: OnboardingProgress): Record<string, { total: number; done: number }> {
  const result: Record<string, { total: number; done: number }> = {};
  for (const item of progress.items) {
    if (!result[item.category]) result[item.category] = { total: 0, done: 0 };
    result[item.category].total++;
    if (item.completedAt !== null) result[item.category].done++;
  }
  return result;
}

const NOW = 1_700_000_000_000;
const PROGRESS: OnboardingProgress = {
  venueId: "v1", ownerId: "u1", startedAt: NOW - 3 * 86_400_000,
  items: [
    { id: "c1", title: "Add photos",         category: "listing",      required: true,  completedAt: NOW - 2 * 86_400_000, order: 1 },
    { id: "c2", title: "Verify identity",    category: "verification", required: true,  completedAt: null,                  order: 2 },
    { id: "c3", title: "Add bank account",   category: "banking",      required: true,  completedAt: null,                  order: 3 },
    { id: "c4", title: "Set pricing",        category: "settings",     required: false, completedAt: NOW - 86_400_000,      order: 4 },
  ],
};

describe("Venue onboarding checklist", () => {
  it("completedItems: 2 completed", () => {
    expect(completedItems(PROGRESS).length).toBe(2);
  });

  it("pendingRequired: 2 required items pending", () => {
    expect(pendingRequired(PROGRESS).length).toBe(2);
  });

  it("completionPercent: 2 of 4 = 50%", () => {
    expect(completionPercent(PROGRESS)).toBe(50);
  });

  it("isEligibleToGo: has pending required → false", () => {
    expect(isEligibleToGo(PROGRESS)).toBe(false);
  });

  it("nextStep: next pending by order = c2", () => {
    expect(nextStep(PROGRESS)?.id).toBe("c2");
  });

  it("categoryProgress: verification has 0 done of 1", () => {
    const cat = categoryProgress(PROGRESS);
    expect(cat.verification.done).toBe(0);
    expect(cat.verification.total).toBe(1);
  });
});
