/**
 * Tests for crowd-sourced venue tips and tricks management.
 */

interface VenueTip {
  tipId: string;
  venueId: string;
  authorId: string;
  content: string;
  upvotes: number;
  downvotes: number;
  category: "wifi" | "parking" | "coffee" | "seating" | "hours" | "general";
  submittedAt: number;
  isVerified: boolean;
}

function tipScore(tip: VenueTip): number {
  return tip.upvotes - tip.downvotes;
}

function topTipsForVenue(
  tips: VenueTip[],
  venueId: string,
  limit = 5
): VenueTip[] {
  return tips
    .filter((t) => t.venueId === venueId)
    .sort((a, b) => tipScore(b) - tipScore(a))
    .slice(0, limit);
}

function verifiedTipsByCategory(
  tips: VenueTip[],
  venueId: string,
  category: VenueTip["category"]
): VenueTip[] {
  return tips.filter(
    (t) => t.venueId === venueId && t.category === category && t.isVerified
  );
}

function upvoteTip(tip: VenueTip): VenueTip {
  return { ...tip, upvotes: tip.upvotes + 1 };
}

function downvoteTip(tip: VenueTip): VenueTip {
  return { ...tip, downvotes: tip.downvotes + 1 };
}

function tipQualityLabel(tip: VenueTip): "poor" | "okay" | "good" | "great" {
  const score = tipScore(tip);
  if (score >= 10) return "great";
  if (score >= 5) return "good";
  if (score >= 0) return "okay";
  return "poor";
}

const NOW = 1_700_000_000_000;
const TIPS: VenueTip[] = [
  { tipId: "t1", venueId: "v1", authorId: "u1", content: "Best spots near window", upvotes: 15, downvotes: 2, category: "seating", submittedAt: NOW - 3000, isVerified: true  },
  { tipId: "t2", venueId: "v1", authorId: "u2", content: "WiFi password: cowork24", upvotes: 8,  downvotes: 0, category: "wifi",    submittedAt: NOW - 2000, isVerified: true  },
  { tipId: "t3", venueId: "v1", authorId: "u3", content: "Avoid Mondays crowded",  upvotes: 3,  downvotes: 5, category: "general", submittedAt: NOW - 1000, isVerified: false },
  { tipId: "t4", venueId: "v2", authorId: "u4", content: "Free parking behind",    upvotes: 20, downvotes: 1, category: "parking", submittedAt: NOW - 500,  isVerified: true  },
];

describe("Venue crowd-sourced tips", () => {
  it("tipScore: t1 = 15-2 = 13", () => {
    expect(tipScore(TIPS[0])).toBe(13);
  });

  it("topTipsForVenue: v1 sorted by score", () => {
    const top = topTipsForVenue(TIPS, "v1");
    expect(top[0].tipId).toBe("t1"); // score 13
    expect(top[1].tipId).toBe("t2"); // score 8
  });

  it("verifiedTipsByCategory: v1 wifi = 1", () => {
    expect(verifiedTipsByCategory(TIPS, "v1", "wifi")).toHaveLength(1);
  });

  it("upvoteTip: increments upvotes", () => {
    const updated = upvoteTip(TIPS[0]);
    expect(updated.upvotes).toBe(16);
  });

  it("upvoteTip is immutable", () => {
    upvoteTip(TIPS[0]);
    expect(TIPS[0].upvotes).toBe(15);
  });

  it("tipQualityLabel: t1 score 13 → great", () => {
    expect(tipQualityLabel(TIPS[0])).toBe("great");
  });

  it("tipQualityLabel: negative score → poor", () => {
    expect(tipQualityLabel(TIPS[2])).toBe("poor"); // score -2
  });
});
