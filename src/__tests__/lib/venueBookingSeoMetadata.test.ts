/**
 * Tests for venue booking SEO metadata generation utilities.
 */

interface VenueDetails {
  id: string;
  name: string;
  city: string;
  country: string;
  capacity: number;
  categories: string[];
  rating: number;
  reviewCount: number;
  priceFrom: number;
  currency: string;
}

interface SeoMetadata {
  title: string;
  description: string;
  canonicalUrl: string;
  structuredData: Record<string, unknown>;
}

function generateTitle(venue: VenueDetails): string {
  return `${venue.name} - ${venue.categories[0] || "Venue"} in ${venue.city} | WorkSphere`;
}

function generateDescription(venue: VenueDetails): string {
  return `Book ${venue.name} in ${venue.city}, ${venue.country}. Capacity up to ${venue.capacity} guests. Rated ${venue.rating}/5 from ${venue.reviewCount} reviews. From ${venue.currency}${venue.priceFrom}/hour.`;
}

function titleLength(title: string): "ok" | "too_short" | "too_long" {
  if (title.length < 10) return "too_short";
  if (title.length > 60) return "too_long";
  return "ok";
}

function descriptionLength(desc: string): "ok" | "too_short" | "too_long" {
  if (desc.length < 50) return "too_short";
  if (desc.length > 160) return "too_long";
  return "ok";
}

function generateSlug(venueName: string): string {
  return venueName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

function generateCanonicalUrl(venue: VenueDetails, baseUrl = "https://worksphere.com"): string {
  return `${baseUrl}/venues/${generateSlug(venue.name)}-${venue.id}`;
}

const VENUE: VenueDetails = {
  id: "v001", name: "The Grand Hall", city: "London", country: "UK",
  capacity: 300, categories: ["Conference", "Wedding"], rating: 4.7,
  reviewCount: 142, priceFrom: 150, currency: "£",
};

describe("SEO metadata generation", () => {
  it("generateTitle: includes venue name and city", () => {
    const title = generateTitle(VENUE);
    expect(title).toContain("The Grand Hall");
    expect(title).toContain("London");
  });

  it("generateDescription: includes capacity and rating", () => {
    const desc = generateDescription(VENUE);
    expect(desc).toContain("300");
    expect(desc).toContain("4.7");
  });

  it("titleLength: typical title → ok", () => {
    expect(titleLength(generateTitle(VENUE))).toBe("ok");
  });

  it("descriptionLength: generated desc → ok or too_long", () => {
    const status = descriptionLength(generateDescription(VENUE));
    expect(["ok", "too_long"]).toContain(status);
  });

  it("generateSlug: spaces → hyphens, lowercase", () => {
    expect(generateSlug("The Grand Hall")).toBe("the-grand-hall");
  });

  it("generateCanonicalUrl: includes slug and id", () => {
    const url = generateCanonicalUrl(VENUE);
    expect(url).toContain("the-grand-hall");
    expect(url).toContain("v001");
  });
});
