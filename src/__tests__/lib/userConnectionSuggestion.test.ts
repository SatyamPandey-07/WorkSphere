/**
 * Tests for "people you may know" connection suggestion scoring.
 */

interface UserProfile {
  userId: string;
  venuesVisited: string[];
  tags: string[];
  industry?: string;
}

function sharedVenues(a: UserProfile, b: UserProfile): string[] {
  return a.venuesVisited.filter((v) => b.venuesVisited.includes(v));
}

function sharedTags(a: UserProfile, b: UserProfile): string[] {
  return a.tags.filter((t) => b.tags.includes(t));
}

function connectionScore(a: UserProfile, b: UserProfile): number {
  const venueScore = sharedVenues(a, b).length * 3;
  const tagScore = sharedTags(a, b).length * 2;
  const industryBonus = a.industry && a.industry === b.industry ? 5 : 0;
  return venueScore + tagScore + industryBonus;
}

function suggestConnections(
  user: UserProfile,
  candidates: UserProfile[],
  minScore = 3,
  limit = 5
): UserProfile[] {
  return candidates
    .filter((c) => c.userId !== user.userId && connectionScore(user, c) >= minScore)
    .sort((a, b) => connectionScore(user, b) - connectionScore(user, a))
    .slice(0, limit);
}

const USER: UserProfile = {
  userId: "u1",
  venuesVisited: ["v1", "v2", "v3"],
  tags: ["design", "remote-work"],
  industry: "tech",
};

const CANDIDATES: UserProfile[] = [
  { userId: "u2", venuesVisited: ["v1", "v2"],      tags: ["design"],       industry: "tech"    }, // 3+2+5=10
  { userId: "u3", venuesVisited: ["v3"],             tags: ["gaming"],       industry: "media"   }, // 3
  { userId: "u4", venuesVisited: [],                 tags: ["cooking"],      industry: "food"    }, // 0
];

describe("User connection suggestions", () => {
  it("sharedVenues: u1 and u2 share v1, v2", () => {
    expect(sharedVenues(USER, CANDIDATES[0])).toHaveLength(2);
  });

  it("sharedTags: u1 and u2 share design", () => {
    expect(sharedTags(USER, CANDIDATES[0])).toContain("design");
  });

  it("connectionScore: u1 and u2 = 10", () => {
    expect(connectionScore(USER, CANDIDATES[0])).toBe(10);
  });

  it("connectionScore: u1 and u3 = 3 (shared v3)", () => {
    expect(connectionScore(USER, CANDIDATES[3 - 1 - 1])).toBe(3);
  });

  it("connectionScore: u1 and u4 = 0", () => {
    expect(connectionScore(USER, CANDIDATES[2])).toBe(0);
  });

  it("suggestConnections: excludes below minScore", () => {
    const suggestions = suggestConnections(USER, CANDIDATES);
    expect(suggestions.every((s) => connectionScore(USER, s) >= 3)).toBe(true);
  });

  it("suggestConnections: highest scored first", () => {
    const suggestions = suggestConnections(USER, CANDIDATES, 1);
    expect(suggestions[0].userId).toBe("u2");
  });

  it("suggestConnections: excludes self", () => {
    expect(suggestConnections(USER, [USER, ...CANDIDATES]).every((s) => s.userId !== "u1")).toBe(true);
  });
});
