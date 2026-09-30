/**
 * Tests for AI-generated venue description quality and length validation.
 */

interface AiGeneratedDescription {
  venueId: string;
  content: string;
  wordCount: number;
  generatedAt: number;
  approved: boolean;
  language: string;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

function isDescriptionValid(desc: AiGeneratedDescription): boolean {
  return (
    desc.content.trim().length > 0 &&
    desc.wordCount >= 20 &&
    desc.wordCount <= 200
  );
}

function truncateToSentence(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const truncated = text.slice(0, maxChars);
  const lastPeriod = truncated.lastIndexOf(".");
  if (lastPeriod > maxChars * 0.5) return truncated.slice(0, lastPeriod + 1);
  return truncated.slice(0, truncated.lastIndexOf(" ")) + "...";
}

function excerptDescription(desc: AiGeneratedDescription, maxChars = 120): string {
  if (!isDescriptionValid(desc)) return "";
  return truncateToSentence(desc.content, maxChars);
}

const NOW = 1_700_000_000_000;
const GOOD_DESC: AiGeneratedDescription = {
  venueId: "v1",
  content: "The Coffee Hub is a vibrant coworking space in downtown. It offers fast WiFi, comfortable seating, and a warm atmosphere perfect for focused work.",
  wordCount: 25,
  generatedAt: NOW,
  approved: true,
  language: "en",
};

describe("AI venue description validation", () => {
  it("countWords: counts correctly", () => {
    expect(countWords("Hello world foo")).toBe(3);
  });

  it("countWords: handles extra spaces", () => {
    expect(countWords("  hello   world  ")).toBe(2);
  });

  it("isDescriptionValid: valid description → true", () => {
    expect(isDescriptionValid(GOOD_DESC)).toBe(true);
  });

  it("isDescriptionValid: too short (<20 words) → false", () => {
    const short: AiGeneratedDescription = { ...GOOD_DESC, content: "Short.", wordCount: 1 };
    expect(isDescriptionValid(short)).toBe(false);
  });

  it("isDescriptionValid: too long (>200 words) → false", () => {
    const long: AiGeneratedDescription = { ...GOOD_DESC, wordCount: 201 };
    expect(isDescriptionValid(long)).toBe(false);
  });

  it("excerptDescription: empty for invalid", () => {
    const bad: AiGeneratedDescription = { ...GOOD_DESC, wordCount: 1 };
    expect(excerptDescription(bad)).toBe("");
  });

  it("excerptDescription: short enough content unchanged", () => {
    const short = { ...GOOD_DESC, content: "A quick note.", wordCount: 3, wordCount_override: 25 } as AiGeneratedDescription;
    short.wordCount = 25;
    expect(excerptDescription({ ...GOOD_DESC, content: "Short enough." })).toBe("Short enough.");
  });

  it("truncateToSentence: truncates at sentence boundary", () => {
    const text = "First sentence. Second sentence with more text.";
    const result = truncateToSentence(text, 20);
    expect(result.endsWith(".")).toBe(true);
  });
});
