/**
 * Tests for Open Graph and meta tag generation for venue pages.
 */

interface VenueOgData {
  title: string;
  description: string;
  imageUrl: string;
  canonicalUrl: string;
  type: "place" | "business";
  city: string;
  country: string;
}

function buildOgTitle(venue: VenueOgData): string {
  return `${venue.title} | WorkSphere - ${venue.city}`;
}

function buildOgDescription(venue: VenueOgData, maxLength = 160): string {
  const desc = `${venue.description} Located in ${venue.city}, ${venue.country}.`;
  return desc.length <= maxLength ? desc : desc.slice(0, maxLength - 3) + "...";
}

function buildMetaTags(venue: VenueOgData): Record<string, string> {
  return {
    "og:title":       buildOgTitle(venue),
    "og:description": buildOgDescription(venue),
    "og:image":       venue.imageUrl,
    "og:url":         venue.canonicalUrl,
    "og:type":        venue.type,
    "twitter:card":   "summary_large_image",
    "twitter:title":  buildOgTitle(venue),
  };
}

const VENUE: VenueOgData = {
  title: "The Coffee Hub",
  description: "A vibrant coworking café with great WiFi.",
  imageUrl: "https://cdn.worksphere.com/venues/coffee-hub.jpg",
  canonicalUrl: "https://worksphere.com/venues/coffee-hub",
  type: "business",
  city: "New York",
  country: "USA",
};

describe("OG meta tag builder", () => {
  it("buildOgTitle: includes title and city", () => {
    const title = buildOgTitle(VENUE);
    expect(title).toContain("The Coffee Hub");
    expect(title).toContain("New York");
  });

  it("buildOgDescription: includes city and country", () => {
    const desc = buildOgDescription(VENUE);
    expect(desc).toContain("New York");
    expect(desc).toContain("USA");
  });

  it("buildOgDescription: truncates at 160 chars", () => {
    const longVenue: VenueOgData = { ...VENUE, description: "a".repeat(200) };
    const desc = buildOgDescription(longVenue);
    expect(desc.length).toBeLessThanOrEqual(160);
    expect(desc.endsWith("...")).toBe(true);
  });

  it("buildMetaTags: includes all required keys", () => {
    const tags = buildMetaTags(VENUE);
    expect(tags["og:title"]).toBeDefined();
    expect(tags["og:image"]).toBeDefined();
    expect(tags["og:url"]).toBe(VENUE.canonicalUrl);
    expect(tags["twitter:card"]).toBe("summary_large_image");
  });

  it("buildMetaTags: og:type matches venue type", () => {
    expect(buildMetaTags(VENUE)["og:type"]).toBe("business");
  });

  it("buildOgTitle: different venue", () => {
    const paris: VenueOgData = { ...VENUE, title: "Café Paris", city: "Paris" };
    expect(buildOgTitle(paris)).toContain("Paris");
  });
});
