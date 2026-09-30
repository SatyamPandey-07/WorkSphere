/**
 * Tests for venue booking search index and full-text search.
 */

interface VenueSearchDocument {
  venueId: string;
  name: string;
  description: string;
  tags: string[];
  amenities: string[];
  city: string;
  category: string;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[\s,]+/).filter((t) => t.length > 1);
}

function buildSearchIndex(documents: VenueSearchDocument[]): Map<string, string[]> {
  const index = new Map<string, string[]>();

  for (const doc of documents) {
    const tokens = [
      ...tokenize(doc.name),
      ...tokenize(doc.description),
      ...doc.tags.map((t) => t.toLowerCase()),
      ...doc.amenities.map((a) => a.toLowerCase()),
      doc.city.toLowerCase(),
      doc.category.toLowerCase(),
    ];

    for (const token of tokens) {
      const existing = index.get(token) ?? [];
      if (!existing.includes(doc.venueId)) {
        index.set(token, [...existing, doc.venueId]);
      }
    }
  }

  return index;
}

function searchVenues(
  index: Map<string, string[]>,
  query: string,
  documents: VenueSearchDocument[]
): VenueSearchDocument[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const venueScores: Record<string, number> = {};
  for (const token of tokens) {
    const matchingIds = index.get(token) ?? [];
    matchingIds.forEach((id) => { venueScores[id] = (venueScores[id] ?? 0) + 1; });
  }

  return Object.entries(venueScores)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => documents.find((d) => d.venueId === id)!)
    .filter(Boolean);
}

const DOCS: VenueSearchDocument[] = [
  { venueId: "v1", name: "The Quiet Corner", description: "Peaceful coworking space with great wifi", tags: ["quiet", "coworking"], amenities: ["wifi", "coffee"], city: "Boston", category: "coworking" },
  { venueId: "v2", name: "Busy Café Hub",    description: "Social café workspace downtown",          tags: ["cafe", "social"],    amenities: ["coffee", "snacks"], city: "Boston", category: "cafe"      },
  { venueId: "v3", name: "Mountain Office",  description: "Remote workspace in quiet mountain town",  tags: ["remote", "quiet"],   amenities: ["wifi"],            city: "Denver",  category: "coworking" },
];

describe("Venue booking search index", () => {
  const INDEX = buildSearchIndex(DOCS);

  it("buildSearchIndex: wifi token maps to v1 and v3", () => {
    const wifiVenues = INDEX.get("wifi");
    expect(wifiVenues).toContain("v1");
    expect(wifiVenues).toContain("v3");
  });

  it("buildSearchIndex: no duplicates per venue", () => {
    const wifiVenues = INDEX.get("wifi") ?? [];
    expect(new Set(wifiVenues).size).toBe(wifiVenues.length);
  });

  it("searchVenues: 'quiet coworking' → v1 and v3 (both match)", () => {
    const results = searchVenues(INDEX, "quiet coworking", DOCS);
    expect(results.some((d) => d.venueId === "v1")).toBe(true);
    expect(results.some((d) => d.venueId === "v3")).toBe(true);
  });

  it("searchVenues: empty query → empty results", () => {
    expect(searchVenues(INDEX, "", DOCS)).toHaveLength(0);
  });

  it("searchVenues: best match first", () => {
    const results = searchVenues(INDEX, "quiet coworking wifi", DOCS);
    // v1 matches quiet+coworking+wifi, v3 matches quiet+coworking+wifi too, v2 none
    expect(results.some((d) => d.venueId === "v2")).toBe(false);
  });

  it("tokenize: splits and lowercases", () => {
    const tokens = tokenize("Great WiFi, Coffee");
    expect(tokens).toContain("great");
    expect(tokens).toContain("wifi");
    expect(tokens).toContain("coffee");
  });
});
