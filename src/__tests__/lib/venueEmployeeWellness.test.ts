/**
 * Tests for venue employee wellness program management.
 */

interface WellnessActivity {
  activityId: string;
  userId: string;
  venueId: string;
  type: "meditation" | "exercise" | "nutrition" | "mental_health" | "social";
  durationMinutes: number;
  completedAt: number;
  points: number;
}

interface WellnessProfile {
  userId: string;
  venueId: string;
  currentStreak: number;
  totalPoints: number;
  level: number;
  weeklyGoalMinutes: number;
  weeklyMinutesLogged: number;
}

function weeklyProgress(profile: WellnessProfile): number {
  if (profile.weeklyGoalMinutes === 0) return 0;
  return Math.min(100, Math.round((profile.weeklyMinutesLogged / profile.weeklyGoalMinutes) * 100));
}

function isGoalMet(profile: WellnessProfile): boolean {
  return profile.weeklyMinutesLogged >= profile.weeklyGoalMinutes;
}

function logActivity(
  profile: WellnessProfile,
  activity: WellnessActivity
): WellnessProfile {
  const newMinutes = profile.weeklyMinutesLogged + activity.durationMinutes;
  const newPoints = profile.totalPoints + activity.points;
  const newStreak = profile.currentStreak + 1;
  const newLevel = Math.floor(newPoints / 500) + 1;
  return {
    ...profile,
    weeklyMinutesLogged: newMinutes,
    totalPoints: newPoints,
    currentStreak: newStreak,
    level: newLevel,
  };
}

function activityTypeBreakdown(
  activities: WellnessActivity[],
  userId: string
): Record<string, number> {
  const breakdown: Record<string, number> = {};
  activities.filter((a) => a.userId === userId).forEach((a) => {
    breakdown[a.type] = (breakdown[a.type] ?? 0) + a.durationMinutes;
  });
  return breakdown;
}

const NOW = 1_700_000_000_000;
const PROFILE: WellnessProfile = {
  userId: "u1", venueId: "v1",
  currentStreak: 5, totalPoints: 450,
  level: 1, weeklyGoalMinutes: 150, weeklyMinutesLogged: 90,
};

const ACTIVITY: WellnessActivity = {
  activityId: "wa1", userId: "u1", venueId: "v1",
  type: "exercise", durationMinutes: 30, completedAt: NOW, points: 50,
};

describe("Venue employee wellness program", () => {
  it("weeklyProgress: 90/150 = 60%", () => {
    expect(weeklyProgress(PROFILE)).toBe(60);
  });

  it("weeklyProgress: capped at 100%", () => {
    expect(weeklyProgress({ ...PROFILE, weeklyMinutesLogged: 200 })).toBe(100);
  });

  it("isGoalMet: 90 < 150 → false", () => {
    expect(isGoalMet(PROFILE)).toBe(false);
  });

  it("isGoalMet: met goal → true", () => {
    expect(isGoalMet({ ...PROFILE, weeklyMinutesLogged: 150 })).toBe(true);
  });

  it("logActivity: updates minutes and points", () => {
    const updated = logActivity(PROFILE, ACTIVITY);
    expect(updated.weeklyMinutesLogged).toBe(120);
    expect(updated.totalPoints).toBe(500);
  });

  it("logActivity: level up at 500 points", () => {
    const updated = logActivity(PROFILE, ACTIVITY);
    expect(updated.level).toBe(2); // 500/500 + 1 = 2
  });

  it("activityTypeBreakdown: sums minutes by type", () => {
    const activities = [
      ACTIVITY,
      { ...ACTIVITY, activityId: "wa2", type: "meditation" as const, durationMinutes: 15 },
      { ...ACTIVITY, activityId: "wa3", type: "exercise" as const, durationMinutes: 45 },
    ];
    const breakdown = activityTypeBreakdown(activities, "u1");
    expect(breakdown.exercise).toBe(75);
    expect(breakdown.meditation).toBe(15);
  });
});
