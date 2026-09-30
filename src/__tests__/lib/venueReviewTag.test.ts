/**
 * Tests for venue review tag aggregation and popularity.
 */

interface ReviewTag {
  tag: string;
  count: number;
  sentiment: "positive" | "negative" | "neutral";
}

function aggregateReviewTags(reviews: string[][]): ReviewTag[] {
  const counts: Record<string, number> = {};
  for (const tags of reviews) {
    for (const tag of tags) {
      counts[tag] = (counts[tag] ?? 0) + 1;
    }
  }
  return Object.entries(counts)
    .map(([tag, count]) => ({ tag, count, sentiment: "neutral" as const }))
    .sort((a, b) => b.count - a.count);
}

function topTags(tags: ReviewTag[], limit: number): ReviewTag[] {
  return tags.slice(0, limit);
}

function filterBySentiment(
  tags: ReviewTag[],
  sentiment: ReviewTag["sentiment"]
): ReviewTag[] {
  return tags.filter((t) => t.sentiment === sentiment);
}

function tagCloud(tags: ReviewTag[], maxCount: number): { tag: string; weight: number }[] {
  return tags.map((t) => ({
    tag: t.tag,
    weight: Math.round((t.count / maxCount) * 100),
  }));
}

const REVIEWS = [
  ["great-wifi", "quiet", "good-coffee"],
  ["great-wifi", "comfortable-seating"],
  ["quiet", "great-wifi", "good-coffee"],
  ["noisy", "slow-wifi"],
];

describe("Venue review tags", () => {
  it("aggregateReviewTags: great-wifi appears 3 times", () => {
    const tags = aggregateReviewTags(REVIEWS);
    expect(tags.find((t) => t.tag === "great-wifi")!.count).toBe(3);
  });

  it("aggregateReviewTags: sorted by count descending", () => {
    const tags = aggregateReviewTags(REVIEWS);
    expect(tags[0].count).toBeGreaterThanOrEqual(tags[1].count);
  });

  it("topTags: returns at most limit", () => {
    const tags = aggregateReviewTags(REVIEWS);
    expect(topTags(tags, 2)).toHaveLength(2);
  });

  it("filterBySentiment: all neutral initially", () => {
    const tags = aggregateReviewTags(REVIEWS);
    expect(filterBySentiment(tags, "neutral")).toHaveLength(tags.length);
  });

  it("filterBySentiment: positive tags", () => {
    const tags: ReviewTag[] = [
      { tag: "great-wifi", count: 3, sentiment: "positive" },
      { tag: "noisy",      count: 1, sentiment: "negative" },
    ];
    expect(filterBySentiment(tags, "positive")).toHaveLength(1);
  });

  it("tagCloud: max tag gets weight 100", () => {
    const tags: ReviewTag[] = [{ tag: "wifi", count: 10, sentiment: "positive" }];
    const cloud = tagCloud(tags, 10);
    expect(cloud[0].weight).toBe(100);
  });

  it("tagCloud: scales other tags proportionally", () => {
    const tags: ReviewTag[] = [
      { tag: "a", count: 5, sentiment: "positive" },
    ];
    const cloud = tagCloud(tags, 10);
    expect(cloud[0].weight).toBe(50);
  });
});
