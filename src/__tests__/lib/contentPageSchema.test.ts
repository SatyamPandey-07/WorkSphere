/**
 * Tests for content page schema.org structured data generation.
 */

interface VenueStructuredData {
  "@type": string;
  name: string;
  description: string;
  url: string;
  address: {
    "@type": string;
    streetAddress: string;
    addressLocality: string;
    addressCountry: string;
  };
  aggregateRating?: {
    "@type": string;
    ratingValue: number;
    reviewCount: number;
  };
  openingHours?: string[];
}

function buildVenueSchema(
  name: string,
  description: string,
  url: string,
  street: string,
  city: string,
  country: string,
  rating?: { value: number; count: number },
  openingHours?: string[]
): VenueStructuredData {
  const schema: VenueStructuredData = {
    "@type": "LocalBusiness",
    name,
    description,
    url,
    address: { "@type": "PostalAddress", streetAddress: street, addressLocality: city, addressCountry: country },
  };
  if (rating) {
    schema.aggregateRating = { "@type": "AggregateRating", ratingValue: rating.value, reviewCount: rating.count };
  }
  if (openingHours) schema.openingHours = openingHours;
  return schema;
}

function isValidSchema(schema: VenueStructuredData): boolean {
  return (
    !!schema["@type"] &&
    !!schema.name.trim() &&
    !!schema.url &&
    !!schema.address.streetAddress &&
    !!schema.address.addressLocality
  );
}

function schemaToJson(schema: VenueStructuredData): string {
  return JSON.stringify({ "@context": "https://schema.org", ...schema });
}

describe("Content page structured data", () => {
  const SCHEMA = buildVenueSchema(
    "The Coffee Hub", "Great coworking space",
    "https://worksphere.com/venue/coffee-hub",
    "123 Main St", "New York", "US",
    { value: 4.5, count: 100 },
    ["Mo-Fr 08:00-20:00"]
  );

  it("buildVenueSchema: correct @type", () => {
    expect(SCHEMA["@type"]).toBe("LocalBusiness");
  });

  it("buildVenueSchema: has aggregateRating", () => {
    expect(SCHEMA.aggregateRating!.ratingValue).toBe(4.5);
  });

  it("buildVenueSchema: has openingHours", () => {
    expect(SCHEMA.openingHours).toContain("Mo-Fr 08:00-20:00");
  });

  it("buildVenueSchema: no rating when omitted", () => {
    const noRating = buildVenueSchema("A", "B", "https://x.com", "c", "d", "US");
    expect(noRating.aggregateRating).toBeUndefined();
  });

  it("isValidSchema: valid schema → true", () => {
    expect(isValidSchema(SCHEMA)).toBe(true);
  });

  it("isValidSchema: missing name → false", () => {
    expect(isValidSchema({ ...SCHEMA, name: "" })).toBe(false);
  });

  it("schemaToJson: includes @context", () => {
    const json = JSON.parse(schemaToJson(SCHEMA));
    expect(json["@context"]).toBe("https://schema.org");
  });

  it("schemaToJson: valid JSON", () => {
    expect(() => JSON.parse(schemaToJson(SCHEMA))).not.toThrow();
  });
});
