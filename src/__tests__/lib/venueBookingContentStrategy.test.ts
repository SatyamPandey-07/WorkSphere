/**
 * Tests for venue content strategy and marketing copy scoring.
 */

interface VenueListingContent {
  venueId: string;
  title: string;
  description: string;
  highlights: string[];
  nearbyAttractions: string[];
  tags: string[];
  wordCount: number;
  hasVirtualTour: boolean;
  hasPricing: boolean;
  hasCapacity: boolean;
}

interface ContentScore {
  completeness: number;  // 0-100
  readability: number;   // 0-100
  seoStrength: number;   // 0-100
  overall: number;       // 0-100
}

function completenessScore(content: VenueListingContent): number {
  let score = 0;
  if (content.title.length >= 20)          score += 20;
  if (content.description.length >= 100)   score += 25;
  if (content.highlights.length >= 3)      score += 15;
  if (content.tags.length >= 5)            score += 10;
  if (content.hasVirtualTour)              score += 10;
  if (content.hasPricing)                  score += 10;
  if (content.hasCapacity)                 score += 5;
  if (content.nearbyAttractions.length >= 2) score += 5;
  return Math.min(score, 100);
}

function readabilityScore(content: VenueListingContent): number {
  let score = 50; // base
  if (content.wordCount >= 150 && content.wordCount <= 500) score += 30;
  else if (content.wordCount > 500) score += 10;
  if (content.highlights.length > 0) score += 20;
  return Math.min(score, 100);
}

function seoStrength(content: VenueListingContent): number {
  let score = 0;
  if (content.title.length >= 30 && content.title.length <= 60) score += 30;
  if (content.description.length >= 150)  score += 25;
  if (content.tags.length >= 8)           score += 20;
  if (content.nearbyAttractions.length >= 3) score += 15;
  if (content.description.length <= 300)  score += 10;
  return Math.min(score, 100);
}

function contentScore(content: VenueListingContent): ContentScore {
  const comp = completenessScore(content);
  const read = readabilityScore(content);
  const seo  = seoStrength(content);
  return {
    completeness: comp,
    readability: read,
    seoStrength: seo,
    overall: Math.round((comp * 0.4 + read * 0.3 + seo * 0.3)),
  };
}

const GOOD_CONTENT: VenueListingContent = {
  venueId: "v1",
  title: "The Grand Conference Hall - Premier London Venue",
  description: "A stunning conference venue in central London, accommodating up to 300 delegates. Equipped with state-of-the-art AV technology, natural lighting, and flexible floor plans for any corporate event format.",
  highlights: ["Natural daylight", "4K projection system", "Dedicated event coordinator"],
  nearbyAttractions: ["Westminster", "London Eye", "South Bank"],
  tags: ["conference", "london", "corporate", "300-capacity", "av-equipped", "central-location", "catering", "flexible"],
  wordCount: 200, hasVirtualTour: true, hasPricing: true, hasCapacity: true,
};

describe("Content strategy scoring", () => {
  it("completenessScore: well-filled listing → high score", () => {
    expect(completenessScore(GOOD_CONTENT)).toBeGreaterThanOrEqual(90);
  });

  it("readabilityScore: 200 word description → high", () => {
    expect(readabilityScore(GOOD_CONTENT)).toBeGreaterThan(70);
  });

  it("seoStrength: 8 tags and rich description → high", () => {
    expect(seoStrength(GOOD_CONTENT)).toBeGreaterThan(60);
  });

  it("contentScore: overall > 75 for good content", () => {
    expect(contentScore(GOOD_CONTENT).overall).toBeGreaterThan(75);
  });

  it("completenessScore: minimal content → low score", () => {
    const minimal: VenueListingContent = {
      venueId: "v2", title: "Hall", description: "Nice place",
      highlights: [], nearbyAttractions: [], tags: [],
      wordCount: 10, hasVirtualTour: false, hasPricing: false, hasCapacity: false,
    };
    expect(completenessScore(minimal)).toBeLessThan(30);
  });
});
