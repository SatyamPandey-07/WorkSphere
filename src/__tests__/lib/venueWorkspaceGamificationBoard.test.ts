/**
 * Tests for venue workspace gamification leaderboard.
 */

interface GamificationEntry {
  userId: string;
  displayName: string;
  totalPoints: number;
  weeklyPoints: number;
  level: number;
  badges: string[];
  rank?: number;
}

function assignRanks(entries: GamificationEntry[]): GamificationEntry[] {
  return [...entries]
    .sort((a, b) => b.totalPoints - a.totalPoints)
    .map((entry, idx) => ({ ...entry, rank: idx + 1 }));
}

function weeklyLeaderboard(entries: GamificationEntry[], limit = 10): GamificationEntry[] {
  return [...entries]
    .sort((a, b) => b.weeklyPoints - a.weeklyPoints)
    .slice(0, limit)
    .map((entry, idx) => ({ ...entry, rank: idx + 1 }));
}

function levelUpEligible(entry: GamificationEntry): boolean {
  const levelThresholds = [0, 100, 300, 600, 1000, 1500, 2500];
  const nextThreshold = levelThresholds[entry.level];
  return nextThreshold !== undefined && entry.totalPoints >= nextThreshold;
}

function pointsToNextLevel(entry: GamificationEntry): number | null {
  const levelThresholds = [0, 100, 300, 600, 1000, 1500, 2500];
  if (entry.level >= levelThresholds.length) return null;
  return Math.max(0, levelThresholds[entry.level] - entry.totalPoints);
}

function hasBadge(entry: GamificationEntry, badge: string): boolean {
  return entry.badges.includes(badge);
}

const ENTRIES: GamificationEntry[] = [
  { userId: "u1", displayName: "Alice",  totalPoints: 1200, weeklyPoints: 150, level: 5, badges: ["explorer", "reviewer"] },
  { userId: "u2", displayName: "Bob",    totalPoints: 800,  weeklyPoints: 200, level: 4, badges: ["explorer"]             },
  { userId: "u3", displayName: "Carol",  totalPoints: 500,  weeklyPoints: 80,  level: 3, badges: []                       },
];

describe("Workspace gamification leaderboard", () => {
  it("assignRanks: highest points = rank 1", () => {
    const ranked = assignRanks(ENTRIES);
    expect(ranked[0].userId).toBe("u1");
    expect(ranked[0].rank).toBe(1);
  });

  it("weeklyLeaderboard: Bob has most weekly points → rank 1", () => {
    const weekly = weeklyLeaderboard(ENTRIES);
    expect(weekly[0].userId).toBe("u2");
  });

  it("levelUpEligible: Alice at 1200 pts, level 5 threshold 1500 → not eligible", () => {
    expect(levelUpEligible(ENTRIES[0])).toBe(false); // needs 1500
  });

  it("levelUpEligible: Bob at 800 pts, level 4 threshold 1000 → not eligible", () => {
    expect(levelUpEligible(ENTRIES[1])).toBe(false);
  });

  it("pointsToNextLevel: Alice needs 300 more for level 6", () => {
    expect(pointsToNextLevel(ENTRIES[0])).toBe(300); // 1500-1200
  });

  it("hasBadge: Alice has explorer", () => {
    expect(hasBadge(ENTRIES[0], "explorer")).toBe(true);
  });

  it("hasBadge: Carol no badges → false", () => {
    expect(hasBadge(ENTRIES[2], "explorer")).toBe(false);
  });

  it("assignRanks is immutable", () => {
    const original = ENTRIES.map((e) => e.userId);
    assignRanks(ENTRIES);
    expect(ENTRIES.map((e) => e.userId)).toEqual(original);
  });
});
