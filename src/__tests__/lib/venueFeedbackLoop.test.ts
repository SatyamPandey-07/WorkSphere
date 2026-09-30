/**
 * Tests for venue continuous feedback improvement loop.
 */

interface FeedbackTheme {
  themeId: string;
  venueId: string;
  topic: string;
  occurrences: number;
  avgSentimentScore: number;  // -1 to 1 (-1=negative, 1=positive)
  firstSeenAt: number;
  lastSeenAt: number;
  isAddressed: boolean;
}

function prioritizeFeedbackThemes(themes: FeedbackTheme[], venueId: string): FeedbackTheme[] {
  return themes
    .filter((t) => t.venueId === venueId && !t.isAddressed)
    .sort((a, b) => {
      // Prioritize by: negative sentiment × high frequency
      const scoreA = Math.abs(a.avgSentimentScore) * a.occurrences * (a.avgSentimentScore < 0 ? 2 : 1);
      const scoreB = Math.abs(b.avgSentimentScore) * b.occurrences * (b.avgSentimentScore < 0 ? 2 : 1);
      return scoreB - scoreA;
    });
}

function markThemeAddressed(themes: FeedbackTheme[], themeId: string): FeedbackTheme[] {
  return themes.map((t) => (t.themeId === themeId ? { ...t, isAddressed: true } : t));
}

function feedbackHealthScore(themes: FeedbackTheme[], venueId: string): number {
  const venue = themes.filter((t) => t.venueId === venueId);
  if (venue.length === 0) return 100;
  const avgSentiment = venue.reduce((s, t) => s + t.avgSentimentScore, 0) / venue.length;
  const addressedRate = venue.filter((t) => t.isAddressed).length / venue.length;
  return Math.round((avgSentiment + 1) * 40 + addressedRate * 20);
}

function recurringThemes(themes: FeedbackTheme[], venueId: string, minOccurrences = 5): FeedbackTheme[] {
  return themes.filter(
    (t) => t.venueId === venueId && t.occurrences >= minOccurrences && !t.isAddressed
  );
}

const NOW = 1_700_000_000_000;
const THEMES: FeedbackTheme[] = [
  { themeId: "t1", venueId: "v1", topic: "slow_wifi",   occurrences: 20, avgSentimentScore: -0.8, firstSeenAt: NOW - 30_000, lastSeenAt: NOW - 1000, isAddressed: false },
  { themeId: "t2", venueId: "v1", topic: "great_coffee",occurrences: 15, avgSentimentScore:  0.9, firstSeenAt: NOW - 20_000, lastSeenAt: NOW - 2000, isAddressed: false },
  { themeId: "t3", venueId: "v1", topic: "parking",     occurrences: 8,  avgSentimentScore: -0.5, firstSeenAt: NOW - 15_000, lastSeenAt: NOW - 3000, isAddressed: true  },
  { themeId: "t4", venueId: "v1", topic: "noisy",       occurrences: 3,  avgSentimentScore: -0.6, firstSeenAt: NOW - 5_000,  lastSeenAt: NOW - 500,  isAddressed: false },
];

describe("Venue feedback improvement loop", () => {
  it("prioritizeFeedbackThemes: slow wifi (negative × high freq) first", () => {
    const prioritized = prioritizeFeedbackThemes(THEMES, "v1");
    expect(prioritized[0].themeId).toBe("t1");
  });

  it("prioritizeFeedbackThemes: excludes addressed themes", () => {
    const prioritized = prioritizeFeedbackThemes(THEMES, "v1");
    expect(prioritized.every((t) => !t.isAddressed)).toBe(true);
  });

  it("markThemeAddressed: sets isAddressed = true", () => {
    const updated = markThemeAddressed(THEMES, "t1");
    expect(updated.find((t) => t.themeId === "t1")!.isAddressed).toBe(true);
  });

  it("markThemeAddressed is immutable", () => {
    markThemeAddressed(THEMES, "t1");
    expect(THEMES.find((t) => t.themeId === "t1")!.isAddressed).toBe(false);
  });

  it("feedbackHealthScore: positive with high addressed rate", () => {
    const allAddressed = THEMES.map((t) => ({ ...t, isAddressed: true, avgSentimentScore: 0.5 }));
    expect(feedbackHealthScore(allAddressed, "v1")).toBeGreaterThan(50);
  });

  it("recurringThemes: slow wifi (20) and coffee (15) qualify", () => {
    const recurring = recurringThemes(THEMES, "v1");
    expect(recurring.map((t) => t.themeId)).toContain("t1");
    expect(recurring.map((t) => t.themeId)).toContain("t2");
    expect(recurring.map((t) => t.themeId)).not.toContain("t4"); // only 3 occurrences
  });
});
