/**
 * Tests for user achievement milestone tracking.
 */

interface Milestone {
  id: string;
  name: string;
  description: string;
  requirement: number;
  metric: "bookings" | "reviews" | "venues_visited" | "hours_worked" | "referrals";
  rewardPoints: number;
  badgeIcon: string;
}

const MILESTONES: Milestone[] = [
  { id: "m1", name: "First Booking",  description: "Make your first booking", requirement: 1,   metric: "bookings",       rewardPoints: 100, badgeIcon: "book" },
  { id: "m2", name: "Explorer",       description: "Visit 10 venues",         requirement: 10,  metric: "venues_visited", rewardPoints: 250, badgeIcon: "map"  },
  { id: "m3", name: "Dedicated",      description: "Log 100 work hours",       requirement: 100, metric: "hours_worked",   rewardPoints: 500, badgeIcon: "clock"},
  { id: "m4", name: "Reviewer",       description: "Write 5 reviews",          requirement: 5,   metric: "reviews",        rewardPoints: 150, badgeIcon: "star" },
];

interface UserStats {
  bookings: number;
  reviews: number;
  venues_visited: number;
  hours_worked: number;
  referrals: number;
}

function isMilestoneAchieved(milestone: Milestone, stats: UserStats): boolean {
  return stats[milestone.metric] >= milestone.requirement;
}

function achievedMilestones(stats: UserStats): Milestone[] {
  return MILESTONES.filter((m) => isMilestoneAchieved(m, stats));
}

function totalMilestonePoints(stats: UserStats): number {
  return achievedMilestones(stats).reduce((sum, m) => sum + m.rewardPoints, 0);
}

function nextMilestone(stats: UserStats, metric: Milestone["metric"]): Milestone | null {
  return MILESTONES
    .filter((m) => m.metric === metric && !isMilestoneAchieved(m, stats))
    .sort((a, b) => a.requirement - b.requirement)[0] ?? null;
}

describe("User achievement milestones", () => {
  const LOW_STATS: UserStats = { bookings: 0, reviews: 0, venues_visited: 0, hours_worked: 0, referrals: 0 };
  const HIGH_STATS: UserStats = { bookings: 5, reviews: 10, venues_visited: 15, hours_worked: 200, referrals: 3 };

  it("isMilestoneAchieved: first booking with 1 booking → true", () => {
    expect(isMilestoneAchieved(MILESTONES[0], { ...LOW_STATS, bookings: 1 })).toBe(true);
  });

  it("isMilestoneAchieved: explorer with 5 venues → false", () => {
    expect(isMilestoneAchieved(MILESTONES[1], { ...LOW_STATS, venues_visited: 5 })).toBe(false);
  });

  it("achievedMilestones: all with HIGH_STATS", () => {
    expect(achievedMilestones(HIGH_STATS)).toHaveLength(4);
  });

  it("achievedMilestones: none with LOW_STATS", () => {
    expect(achievedMilestones(LOW_STATS)).toHaveLength(0);
  });

  it("totalMilestonePoints: all achieved = 1000", () => {
    expect(totalMilestonePoints(HIGH_STATS)).toBe(1000);
  });

  it("nextMilestone: first booking not yet done", () => {
    const next = nextMilestone(LOW_STATS, "bookings");
    expect(next!.id).toBe("m1");
  });

  it("nextMilestone: all bookings milestones done → null", () => {
    expect(nextMilestone(HIGH_STATS, "bookings")).toBeNull();
  });
});
