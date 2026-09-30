/**
 * Tests for venue micro-moment detection (I-want-to-go, I-want-to-book).
 */

type MicroMomentType = "i_want_to_find" | "i_want_to_book" | "i_want_to_know" | "i_want_to_do";

interface SearchIntent {
  query: string;
  location: boolean;
  timeContext?: "now" | "soon" | "plan";
  filterUsed: boolean;
  previousSearches: string[];
}

function classifyMicroMoment(intent: SearchIntent): MicroMomentType {
  const query = intent.query.toLowerCase();

  if (intent.timeContext === "now" || query.includes("open now") || query.includes("available today")) {
    return "i_want_to_find";
  }

  if (query.includes("book") || query.includes("reserve") || (intent.filterUsed && intent.timeContext === "soon")) {
    return "i_want_to_book";
  }

  if (query.includes("how") || query.includes("what") || query.includes("review")) {
    return "i_want_to_know";
  }

  if (query.includes("near me") || intent.location) {
    return "i_want_to_find";
  }

  return "i_want_to_do";
}

function isByingIntent(intent: SearchIntent): boolean {
  const moment = classifyMicroMoment(intent);
  return moment === "i_want_to_book" || (moment === "i_want_to_find" && intent.filterUsed);
}

function momentPersonalization(moment: MicroMomentType): string[] {
  const personalizations: Record<MicroMomentType, string[]> = {
    i_want_to_find: ["Show map view", "Enable location", "Sort by distance"],
    i_want_to_book: ["Show available slots", "Quick booking form", "Show prices"],
    i_want_to_know: ["Show reviews", "Amenity details", "Compare venues"],
    i_want_to_do: ["Suggest venues", "Show nearby events", "Popular spaces"],
  };
  return personalizations[moment];
}

describe("Venue micro-moment detection", () => {
  it("classifyMicroMoment: 'open now' → i_want_to_find", () => {
    const intent: SearchIntent = { query: "open now", location: false, timeContext: "now", filterUsed: false, previousSearches: [] };
    expect(classifyMicroMoment(intent)).toBe("i_want_to_find");
  });

  it("classifyMicroMoment: 'book a desk' → i_want_to_book", () => {
    const intent: SearchIntent = { query: "book a desk downtown", location: false, filterUsed: false, previousSearches: [] };
    expect(classifyMicroMoment(intent)).toBe("i_want_to_book");
  });

  it("classifyMicroMoment: 'what is coworking' → i_want_to_know", () => {
    const intent: SearchIntent = { query: "what is a coworking space", location: false, filterUsed: false, previousSearches: [] };
    expect(classifyMicroMoment(intent)).toBe("i_want_to_know");
  });

  it("classifyMicroMoment: location enabled → i_want_to_find", () => {
    const intent: SearchIntent = { query: "workspace", location: true, filterUsed: false, previousSearches: [] };
    expect(classifyMicroMoment(intent)).toBe("i_want_to_find");
  });

  it("isByingIntent: reserve query → true", () => {
    const intent: SearchIntent = { query: "reserve a meeting room", location: false, filterUsed: false, previousSearches: [] };
    expect(isByingIntent(intent)).toBe(true);
  });

  it("momentPersonalization: i_want_to_book → shows slots", () => {
    const perso = momentPersonalization("i_want_to_book");
    expect(perso).toContain("Show available slots");
  });

  it("momentPersonalization: i_want_to_find → shows map", () => {
    expect(momentPersonalization("i_want_to_find")).toContain("Show map view");
  });
});
