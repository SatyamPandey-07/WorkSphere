/**
 * Tests for venue booking chatbot intent classification utilities.
 */

type IntentCategory =
  | "venue_search"
  | "availability_check"
  | "price_inquiry"
  | "booking_create"
  | "booking_modify"
  | "booking_cancel"
  | "support_request"
  | "general_inquiry";

interface Intent {
  category: IntentCategory;
  confidence: number; // 0-1
  entities: Record<string, string>;
}

interface ChatMessage {
  text: string;
  userId: string;
  timestamp: number;
}

function highConfidenceIntent(intents: Intent[], threshold = 0.8): Intent | null {
  const sorted = [...intents].sort((a, b) => b.confidence - a.confidence);
  return sorted[0]?.confidence >= threshold ? sorted[0] : null;
}

function requiresHumanHandoff(intent: Intent): boolean {
  return intent.category === "support_request" && intent.confidence < 0.7;
}

function extractEntities(intents: Intent[], key: string): string[] {
  return intents
    .filter((i) => i.entities[key] !== undefined)
    .map((i) => i.entities[key]);
}

function intentDistribution(intents: Intent[]): Record<IntentCategory, number> {
  const dist: Partial<Record<IntentCategory, number>> = {};
  for (const i of intents) {
    dist[i.category] = (dist[i.category] ?? 0) + 1;
  }
  return dist as Record<IntentCategory, number>;
}

function avgConfidence(intents: Intent[], category?: IntentCategory): number {
  const filtered = category ? intents.filter((i) => i.category === category) : intents;
  if (filtered.length === 0) return 0;
  return Math.round(filtered.reduce((s, i) => s + i.confidence, 0) / filtered.length * 100) / 100;
}

const INTENTS: Intent[] = [
  { category: "venue_search",     confidence: 0.92, entities: { location: "London", date: "2026-11-01" } },
  { category: "booking_create",   confidence: 0.85, entities: { venueId: "v1", date: "2026-11-01" } },
  { category: "support_request",  confidence: 0.6,  entities: { issue: "payment" } },
  { category: "price_inquiry",    confidence: 0.78, entities: { venueId: "v2" } },
];

describe("Chatbot intent classification", () => {
  it("highConfidenceIntent: 0.92 exceeds 0.8 → returns intent", () => {
    const intent = highConfidenceIntent(INTENTS);
    expect(intent?.category).toBe("venue_search");
  });

  it("highConfidenceIntent: no intent above threshold → null", () => {
    expect(highConfidenceIntent(INTENTS, 0.99)).toBeNull();
  });

  it("requiresHumanHandoff: low-confidence support intent → true", () => {
    expect(requiresHumanHandoff(INTENTS[2])).toBe(true);
  });

  it("extractEntities: location from venue_search", () => {
    const locs = extractEntities(INTENTS, "location");
    expect(locs).toContain("London");
  });

  it("avgConfidence: all intents avg", () => {
    const avg = avgConfidence(INTENTS);
    expect(avg).toBeGreaterThan(0.7);
    expect(avg).toBeLessThan(1);
  });

  it("intentDistribution: 1 support_request", () => {
    expect(intentDistribution(INTENTS).support_request).toBe(1);
  });
});
