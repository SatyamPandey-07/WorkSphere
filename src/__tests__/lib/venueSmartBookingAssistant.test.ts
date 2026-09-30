/**
 * Tests for AI-powered smart booking assistant responses.
 */

type AssistantContext = "search" | "availability" | "pricing" | "amenities" | "directions" | "booking";

interface AssistantQuery {
  message: string;
  context: AssistantContext;
  venueId?: string;
  userId?: string;
}

interface AssistantResponse {
  message: string;
  actions: string[];
  confidence: number;    // 0-1
  requiresHuman: boolean;
}

function classifyQueryIntent(query: AssistantQuery): "informational" | "transactional" | "navigational" {
  const msg = query.message.toLowerCase();
  if (msg.includes("book") || msg.includes("reserve") || msg.includes("pay")) return "transactional";
  if (msg.includes("how to get") || msg.includes("direction") || msg.includes("where")) return "navigational";
  return "informational";
}

function shouldEscalate(query: AssistantQuery, confidenceThreshold = 0.7): boolean {
  const complexTopics = ["refund", "dispute", "legal", "complaint", "broken"];
  return complexTopics.some((topic) => query.message.toLowerCase().includes(topic));
}

function generateQuickActions(context: AssistantContext): string[] {
  const actions: Record<AssistantContext, string[]> = {
    search:       ["Search nearby", "Filter options", "View map"],
    availability: ["Check slots", "Add to waitlist", "Set reminder"],
    pricing:      ["View pricing", "Apply discount", "Compare prices"],
    amenities:    ["View amenities", "Filter by amenity", "See photos"],
    directions:   ["Get directions", "Save location", "Share location"],
    booking:      ["Book now", "Add to cart", "Save for later"],
  };
  return actions[context];
}

function calculateResponseConfidence(query: AssistantQuery): number {
  const keywords = query.message.toLowerCase().split(/\s+/);
  const specificKeywords = ["how", "when", "where", "price", "cost", "book", "available"];
  const matches = keywords.filter((k) => specificKeywords.includes(k)).length;
  return Math.min(0.95, 0.5 + matches * 0.1);
}

describe("Smart booking assistant", () => {
  const SEARCH_QUERY: AssistantQuery = {
    message: "Find available desks near downtown",
    context: "search",
    userId: "u1",
  };

  it("classifyQueryIntent: search → informational", () => {
    expect(classifyQueryIntent(SEARCH_QUERY)).toBe("informational");
  });

  it("classifyQueryIntent: book query → transactional", () => {
    const bookQuery: AssistantQuery = { message: "I want to book a meeting room", context: "booking" };
    expect(classifyQueryIntent(bookQuery)).toBe("transactional");
  });

  it("classifyQueryIntent: directions query → navigational", () => {
    const dirQuery: AssistantQuery = { message: "how to get there", context: "directions" };
    expect(classifyQueryIntent(dirQuery)).toBe("navigational");
  });

  it("shouldEscalate: normal query → false", () => {
    expect(shouldEscalate(SEARCH_QUERY)).toBe(false);
  });

  it("shouldEscalate: refund query → true", () => {
    const refundQuery: AssistantQuery = { message: "I want a refund for my booking", context: "booking" };
    expect(shouldEscalate(refundQuery)).toBe(true);
  });

  it("generateQuickActions: search context → relevant actions", () => {
    const actions = generateQuickActions("search");
    expect(actions).toContain("Search nearby");
    expect(actions).toHaveLength(3);
  });

  it("calculateResponseConfidence: specific keywords → higher confidence", () => {
    const specific: AssistantQuery = { message: "how much does it cost to book", context: "pricing" };
    const vague: AssistantQuery = { message: "stuff", context: "search" };
    expect(calculateResponseConfidence(specific)).toBeGreaterThan(calculateResponseConfidence(vague));
  });
});
