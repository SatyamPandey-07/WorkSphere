/**
 * Tests for check-in based gamification rewards and challenges.
 */

interface CheckinChallenge {
  challengeId: string;
  title: string;
  description: string;
  requirement: number;  // required check-ins
  bonusPoints: number;
  timeWindowDays: number | null; // null = no time limit
}

interface UserChallengeProgress {
  challengeId: string;
  userId: string;
  checkinsCount: number;
  startedAt: number;
  completedAt: number | null;
}

function isChallengeCompleted(progress: UserChallengeProgress, challenge: CheckinChallenge): boolean {
  return progress.checkinsCount >= challenge.requirement;
}

function isChallengeExpired(
  progress: UserChallengeProgress,
  challenge: CheckinChallenge,
  nowMs: number
): boolean {
  if (challenge.timeWindowDays === null) return false;
  const windowMs = challenge.timeWindowDays * 86_400_000;
  return nowMs - progress.startedAt > windowMs;
}

function progressPercent(progress: UserChallengeProgress, challenge: CheckinChallenge): number {
  return Math.min(100, Math.round((progress.checkinsCount / challenge.requirement) * 100));
}

function recordCheckin(progress: UserChallengeProgress, challenge: CheckinChallenge, nowMs: number): UserChallengeProgress {
  const updated = { ...progress, checkinsCount: progress.checkinsCount + 1 };
  if (isChallengeCompleted(updated, challenge) && !progress.completedAt) {
    return { ...updated, completedAt: nowMs };
  }
  return updated;
}

const NOW = 1_700_000_000_000;
const CHALLENGE: CheckinChallenge = {
  challengeId: "c1", title: "Explorer",
  description: "Check in 5 times", requirement: 5,
  bonusPoints: 200, timeWindowDays: 30,
};

const PROGRESS: UserChallengeProgress = {
  challengeId: "c1", userId: "u1",
  checkinsCount: 3, startedAt: NOW - 7 * 86_400_000,
  completedAt: null,
};

describe("Check-in gamification challenges", () => {
  it("isChallengeCompleted: 3/5 → false", () => {
    expect(isChallengeCompleted(PROGRESS, CHALLENGE)).toBe(false);
  });

  it("isChallengeCompleted: 5/5 → true", () => {
    expect(isChallengeCompleted({ ...PROGRESS, checkinsCount: 5 }, CHALLENGE)).toBe(true);
  });

  it("isChallengeExpired: 7 days in 30-day window → false", () => {
    expect(isChallengeExpired(PROGRESS, CHALLENGE, NOW)).toBe(false);
  });

  it("isChallengeExpired: past window → true", () => {
    expect(isChallengeExpired(PROGRESS, CHALLENGE, NOW + 25 * 86_400_000)).toBe(true);
  });

  it("isChallengeExpired: no time window → false", () => {
    const noWindow = { ...CHALLENGE, timeWindowDays: null };
    expect(isChallengeExpired(PROGRESS, noWindow, NOW + 999_999_999)).toBe(false);
  });

  it("progressPercent: 3/5 = 60%", () => {
    expect(progressPercent(PROGRESS, CHALLENGE)).toBe(60);
  });

  it("progressPercent: capped at 100%", () => {
    expect(progressPercent({ ...PROGRESS, checkinsCount: 10 }, CHALLENGE)).toBe(100);
  });

  it("recordCheckin: increments count", () => {
    const updated = recordCheckin(PROGRESS, CHALLENGE, NOW);
    expect(updated.checkinsCount).toBe(4);
  });

  it("recordCheckin: sets completedAt when reaching requirement", () => {
    const almostDone = { ...PROGRESS, checkinsCount: 4 };
    const completed = recordCheckin(almostDone, CHALLENGE, NOW);
    expect(completed.completedAt).toBe(NOW);
  });
});
