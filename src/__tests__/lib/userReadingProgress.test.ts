/**
 * Tests for user guide/onboarding reading progress tracking.
 */

interface ReadingProgress {
  userId: string;
  articleId: string;
  totalSections: number;
  completedSections: number;
  lastReadAt: number;
  completed: boolean;
}

function progressPercent(progress: ReadingProgress): number {
  if (progress.totalSections === 0) return 0;
  return Math.round((progress.completedSections / progress.totalSections) * 100);
}

function completeSection(progress: ReadingProgress, nowMs: number): ReadingProgress {
  const newCompleted = Math.min(progress.completedSections + 1, progress.totalSections);
  const completed = newCompleted === progress.totalSections;
  return { ...progress, completedSections: newCompleted, completed, lastReadAt: nowMs };
}

function isStale(progress: ReadingProgress, nowMs: number, staleMs = 30 * 86400_000): boolean {
  return !progress.completed && nowMs - progress.lastReadAt > staleMs;
}

function remainingSections(progress: ReadingProgress): number {
  return progress.totalSections - progress.completedSections;
}

const NOW = 1_700_000_000_000;
const PROGRESS: ReadingProgress = {
  userId: "u1", articleId: "guide-1",
  totalSections: 5, completedSections: 2,
  lastReadAt: NOW - 1000, completed: false,
};

describe("User reading progress", () => {
  it("progressPercent: 2/5 = 40%", () => {
    expect(progressPercent(PROGRESS)).toBe(40);
  });

  it("progressPercent: 0 sections → 0", () => {
    expect(progressPercent({ ...PROGRESS, totalSections: 0 })).toBe(0);
  });

  it("completeSection: increments completedSections", () => {
    const updated = completeSection(PROGRESS, NOW);
    expect(updated.completedSections).toBe(3);
  });

  it("completeSection: sets completed=true when all done", () => {
    const almostDone = { ...PROGRESS, completedSections: 4 };
    const done = completeSection(almostDone, NOW);
    expect(done.completed).toBe(true);
  });

  it("completeSection: clamps at totalSections", () => {
    const alreadyDone = { ...PROGRESS, completedSections: 5, completed: true };
    const result = completeSection(alreadyDone, NOW);
    expect(result.completedSections).toBe(5);
  });

  it("completeSection: updates lastReadAt", () => {
    expect(completeSection(PROGRESS, NOW).lastReadAt).toBe(NOW);
  });

  it("isStale: not stale if recent", () => {
    expect(isStale(PROGRESS, NOW)).toBe(false);
  });

  it("isStale: stale if old and not completed", () => {
    expect(isStale(PROGRESS, NOW + 35 * 86400_000)).toBe(true);
  });

  it("remainingSections: 5 - 2 = 3", () => {
    expect(remainingSections(PROGRESS)).toBe(3);
  });
});
