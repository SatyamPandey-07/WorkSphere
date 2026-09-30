/**
 * Tests for chatbot intent classification from user input.
 */

type Intent =
  | "search_venue"
  | "make_booking"
  | "cancel_booking"
  | "get_directions"
  | "contact_support"
  | "unknown";

interface IntentRule {
  intent: Intent;
  keywords: string[];
}

const INTENT_RULES: IntentRule[] = [
  { intent: "search_venue",    keywords: ["find", "search", "venue", "workspace", "cowork"] },
  { intent: "make_booking",    keywords: ["book", "reserve", "schedule", "booking"]        },
  { intent: "cancel_booking",  keywords: ["cancel", "refund", "undo booking"]               },
  { intent: "get_directions",  keywords: ["directions", "address", "location", "how to get"] },
  { intent: "contact_support", keywords: ["help", "support", "problem", "issue", "contact"] },
];

function classifyIntent(input: string): Intent {
  const lower = input.toLowerCase();
  for (const rule of INTENT_RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) return rule.intent;
  }
  return "unknown";
}

function extractVenueQuery(input: string): string | null {
  const match = input.match(/find\s+(.+)|search\s+(?:for\s+)?(.+)/i);
  if (!match) return null;
  return (match[1] ?? match[2]).trim();
}

describe("Chatbot intent classifier", () => {
  it("'find a workspace' → search_venue", () => {
    expect(classifyIntent("find a workspace near me")).toBe("search_venue");
  });

  it("'book a desk' → make_booking", () => {
    expect(classifyIntent("I want to book a desk tomorrow")).toBe("make_booking");
  });

  it("'cancel my booking' → cancel_booking", () => {
    expect(classifyIntent("cancel my booking please")).toBe("cancel_booking");
  });

  it("'directions to venue' → get_directions", () => {
    expect(classifyIntent("how do I get directions to the venue")).toBe("get_directions");
  });

  it("'need help' → contact_support", () => {
    expect(classifyIntent("I need help with my account")).toBe("contact_support");
  });

  it("unrecognized input → unknown", () => {
    expect(classifyIntent("the weather is nice today")).toBe("unknown");
  });

  it("case insensitive matching", () => {
    expect(classifyIntent("FIND ME A VENUE")).toBe("search_venue");
  });

  it("extractVenueQuery: 'find quiet cafes'", () => {
    expect(extractVenueQuery("find quiet cafes")).toBe("quiet cafes");
  });

  it("extractVenueQuery: 'search for coworking'", () => {
    expect(extractVenueQuery("search for coworking")).toBe("coworking");
  });

  it("extractVenueQuery: no match → null", () => {
    expect(extractVenueQuery("book a desk")).toBeNull();
  });
});
