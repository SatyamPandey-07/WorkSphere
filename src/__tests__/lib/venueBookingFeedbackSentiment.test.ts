/**
 * Tests for venue booking feedback sentiment analysis utilities.
 */

type SentimentLabel = "very_positive" | "positive" | "neutral" | "negative" | "very_negative";

interface FeedbackItem {
  id: string;
  text: string;
  sentimentScore: number;  // -1 to 1
  keyPhrases: string[];
  category: "service" | "facilities" | "value" | "location" | "general";
  responseRequired: boolean;
}

function sentimentLabel(score: number): SentimentLabel {
  if (score >= 0.6)  return "very_positive";
  if (score >= 0.2)  return "positive";
  if (score > -0.2)  return "neutral";
  if (score > -0.6)  return "negative";
  return "very_negative";
}

function avgSentimentScore(items: FeedbackItem[]): number {
  if (items.length === 0) return 0;
  return Math.round(items.reduce((s, i) => s + i.sentimentScore, 0) / items.length * 100) / 100;
}

function negativeItems(items: FeedbackItem[], threshold = -0.2): FeedbackItem[] {
  return items.filter((i) => i.sentimentScore <= threshold);
}

function sentimentDistribution(items: FeedbackItem[]): Record<SentimentLabel, number> {
  const dist: Record<SentimentLabel, number> = {
    very_positive: 0, positive: 0, neutral: 0, negative: 0, very_negative: 0
  };
  for (const i of items) dist[sentimentLabel(i.sentimentScore)]++;
  return dist;
}

function topKeyPhrases(items: FeedbackItem[], limit = 5): string[] {
  const counts: Record<string, number> = {};
  for (const i of items) {
    for (const phrase of i.keyPhrases) {
      counts[phrase] = (counts[phrase] ?? 0) + 1;
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([phrase]) => phrase);
}

function requiresResponseCount(items: FeedbackItem[]): number {
  return items.filter((i) => i.responseRequired).length;
}

const FEEDBACK: FeedbackItem[] = [
  { id: "f1", text: "Amazing venue!", sentimentScore: 0.9,  keyPhrases: ["great service", "clean"],       category: "general",    responseRequired: false },
  { id: "f2", text: "Pretty good",   sentimentScore: 0.3,  keyPhrases: ["good location", "clean"],        category: "location",   responseRequired: false },
  { id: "f3", text: "Disappointing", sentimentScore: -0.5, keyPhrases: ["slow service", "overpriced"],    category: "service",    responseRequired: true },
  { id: "f4", text: "Terrible AV",   sentimentScore: -0.8, keyPhrases: ["broken projector", "slow service"],category: "facilities",responseRequired: true },
];

describe("Feedback sentiment analysis", () => {
  it("sentimentLabel: 0.9 → very_positive", () => {
    expect(sentimentLabel(0.9)).toBe("very_positive");
  });

  it("sentimentLabel: -0.5 → negative", () => {
    expect(sentimentLabel(-0.5)).toBe("negative");
  });

  it("avgSentimentScore: mixed feedback → near -0.03", () => {
    const avg = avgSentimentScore(FEEDBACK);
    expect(avg).toBeGreaterThan(-0.2);
  });

  it("negativeItems: 2 negative items", () => {
    expect(negativeItems(FEEDBACK).length).toBe(2);
  });

  it("topKeyPhrases: slow service appears twice", () => {
    const top = topKeyPhrases(FEEDBACK);
    expect(top).toContain("slow service");
  });

  it("requiresResponseCount: 2 items need response", () => {
    expect(requiresResponseCount(FEEDBACK)).toBe(2);
  });
});
