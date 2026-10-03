import {
  generateVenueJsonLd,
  parsePostalAddress,
  extractAmenityFeatures,
} from "@/lib/seo/venueJsonLd";

describe("Venue JSON-LD SEO Structured Data", () => {
  describe("parsePostalAddress", () => {
    it("parses full standard US address", () => {
      const parsed = parsePostalAddress("188 Nassau Ave, Brooklyn, NY 11222");
      expect(parsed).toEqual({
        "@type": "PostalAddress",
        streetAddress: "188 Nassau Ave",
        addressLocality: "Brooklyn",
        postalCode: "11222",
        addressCountry: "US",
      });
    });

    it("parses address with explicit country", () => {
      const parsed = parsePostalAddress("45 Main St, Brooklyn, NY 11201, USA");
      expect(parsed).toEqual({
        "@type": "PostalAddress",
        streetAddress: "45 Main St",
        addressLocality: "Brooklyn",
        postalCode: "11201",
        addressCountry: "USA",
      });
    });

    it("parses international address", () => {
      const parsed = parsePostalAddress("10 Downing St, London, SW1A 2AA, UK");
      expect(parsed).toEqual({
        "@type": "PostalAddress",
        streetAddress: "10 Downing St",
        addressLocality: "London",
        postalCode: "SW1A 2AA",
        addressCountry: "UK",
      });
    });

    it("handles single-line street address without commas", () => {
      const parsed = parsePostalAddress("123 Main Street");
      expect(parsed).toEqual({
        "@type": "PostalAddress",
        streetAddress: "123 Main Street",
        addressLocality: "",
        postalCode: "",
        addressCountry: "US",
      });
    });

    it("handles null or undefined address", () => {
      expect(parsePostalAddress(null)).toEqual({
        "@type": "PostalAddress",
        streetAddress: "",
        addressLocality: "",
        postalCode: "",
        addressCountry: "US",
      });
      expect(parsePostalAddress(undefined)).toEqual({
        "@type": "PostalAddress",
        streetAddress: "",
        addressLocality: "",
        postalCode: "",
        addressCountry: "US",
      });
    });

    it("preserves object-based address input", () => {
      const parsed = parsePostalAddress({
        streetAddress: "789 Broadway",
        addressLocality: "New York",
        postalCode: "10003",
        addressCountry: "US",
      });
      expect(parsed).toEqual({
        "@type": "PostalAddress",
        streetAddress: "789 Broadway",
        addressLocality: "New York",
        postalCode: "10003",
        addressCountry: "US",
      });
    });
  });

  describe("extractAmenityFeatures", () => {
    it("extracts core amenities into LocationFeatureSpecification objects", () => {
      const features = extractAmenityFeatures({
        name: "Test Space",
        latitude: 40.7,
        longitude: -73.9,
        wifiQuality: 5,
        hasOutlets: true,
        hasErgonomic: true,
        hasQuietZone: true,
        hasPhoneBooths: true,
        hasNoMusic: true,
        hasAncHeadsetRental: true,
        dogFriendly: true,
        specialtyEspresso: true,
        hasCCTV: true,
      });

      expect(features).toEqual([
        {
          "@type": "LocationFeatureSpecification",
          name: "WiFi",
          value: true,
        },
        {
          "@type": "LocationFeatureSpecification",
          name: "Power Outlets",
          value: true,
        },
        {
          "@type": "LocationFeatureSpecification",
          name: "Ergonomic Seating",
          value: true,
        },
        {
          "@type": "LocationFeatureSpecification",
          name: "Quiet Zone",
          value: true,
        },
        {
          "@type": "LocationFeatureSpecification",
          name: "Phone Booths",
          value: true,
        },
        {
          "@type": "LocationFeatureSpecification",
          name: "No Music",
          value: true,
        },
        {
          "@type": "LocationFeatureSpecification",
          name: "ANC Headset Rental",
          value: true,
        },
        {
          "@type": "LocationFeatureSpecification",
          name: "Pet Friendly",
          value: true,
        },
        {
          "@type": "LocationFeatureSpecification",
          name: "Specialty Coffee",
          value: true,
        },
        {
          "@type": "LocationFeatureSpecification",
          name: "CCTV Security",
          value: true,
        },
      ]);
    });

    it("returns empty array if venue has no amenities", () => {
      const features = extractAmenityFeatures({
        name: "Minimal Venue",
        latitude: 40.0,
        longitude: -74.0,
      });
      expect(features).toEqual([]);
    });

    it("supports object-based MapMarker amenities", () => {
      const features = extractAmenityFeatures({
        name: "Marker Venue",
        latitude: 40.0,
        longitude: -74.0,
        amenities: {
          wifi: true,
          outlets: true,
          quiet: true,
          hasErgonomic: true,
        },
      });

      expect(features.map((f) => f.name)).toEqual([
        "WiFi",
        "Power Outlets",
        "Quiet Zone",
        "Ergonomic Seating",
      ]);
    });

    it("supports custom string amenities array", () => {
      const features = extractAmenityFeatures({
        name: "Custom Venue",
        latitude: 40.0,
        longitude: -74.0,
        amenities: ["Standing Desks", "Monitor Rental"],
      });

      expect(features).toContainEqual({
        "@type": "LocationFeatureSpecification",
        name: "Standing Desks",
        value: true,
      });
      expect(features).toContainEqual({
        "@type": "LocationFeatureSpecification",
        name: "Monitor Rental",
        value: true,
      });
    });
  });

  describe("generateVenueJsonLd", () => {
    it("generates a complete valid Schema.org LocalBusiness JSON-LD object", () => {
      const venue = {
        id: "v-1",
        name: "Dumbo WorkSpace Collective",
        latitude: 40.7024,
        longitude: -73.9902,
        address: "45 Main St, Brooklyn, NY 11201",
        telephone: "+1-718-555-0142",
        rating: 4.8,
        ratings: [{ id: "r1", wifiQuality: 5 }, { id: "r2", wifiQuality: 5 }],
        wifiQuality: 5,
        hasOutlets: true,
        hasErgonomic: true,
        hasQuietZone: true,
      };

      const jsonLd = generateVenueJsonLd(venue);

      expect(jsonLd["@context"]).toBe("https://schema.org");
      expect(jsonLd["@type"]).toBe("LocalBusiness");
      expect(jsonLd.name).toBe("Dumbo WorkSpace Collective");
      expect(jsonLd.address).toEqual({
        "@type": "PostalAddress",
        streetAddress: "45 Main St",
        addressLocality: "Brooklyn",
        postalCode: "11201",
        addressCountry: "US",
      });
      expect(jsonLd.geo).toEqual({
        "@type": "GeoCoordinates",
        latitude: 40.7024,
        longitude: -73.9902,
      });
      expect(jsonLd.telephone).toBe("+1-718-555-0142");
      expect(jsonLd.aggregateRating).toEqual({
        "@type": "AggregateRating",
        ratingValue: 4.8,
        reviewCount: 2,
      });
      expect(jsonLd.amenityFeature).toEqual([
        {
          "@type": "LocationFeatureSpecification",
          name: "WiFi",
          value: true,
        },
        {
          "@type": "LocationFeatureSpecification",
          name: "Power Outlets",
          value: true,
        },
        {
          "@type": "LocationFeatureSpecification",
          name: "Ergonomic Seating",
          value: true,
        },
        {
          "@type": "LocationFeatureSpecification",
          name: "Quiet Zone",
          value: true,
        },
      ]);

      // Verify JSON serialization produces valid JSON without undefined/null issues
      const serialized = JSON.stringify(jsonLd);
      const parsed = JSON.parse(serialized);
      expect(parsed["@context"]).toBe("https://schema.org");
      expect(parsed["@type"]).toBe("LocalBusiness");
      expect(parsed.telephone).toBe("+1-718-555-0142");
    });

    it("handles venue without ratings gracefully", () => {
      const venue = {
        name: "New Unrated Cowork",
        latitude: 40.7128,
        longitude: -74.006,
        address: "100 Broadway, New York, NY 10005",
      };

      const jsonLd = generateVenueJsonLd(venue);

      expect(jsonLd.aggregateRating).toEqual({
        "@type": "AggregateRating",
        ratingValue: 0,
        reviewCount: 0,
      });
      expect(jsonLd.telephone).toBe("");
    });

    it("calculates average rating when only ratings list is available", () => {
      const venue = {
        name: "Community Lab",
        latitude: 40.72,
        longitude: -73.98,
        ratings: [
          { id: "r1", wifiQuality: 4 },
          { id: "r2", wifiQuality: 5 },
        ],
      };

      const jsonLd = generateVenueJsonLd(venue);

      expect(jsonLd.aggregateRating.ratingValue).toBe(4.5);
      expect(jsonLd.aggregateRating.reviewCount).toBe(2);
    });

    it("uses phoneNumber if telephone is absent", () => {
      const venue = {
        name: "Phone Test Venue",
        latitude: 40.7,
        longitude: -74.0,
        phoneNumber: "+1-800-555-WORK",
      };

      const jsonLd = generateVenueJsonLd(venue);
      expect(jsonLd.telephone).toBe("+1-800-555-WORK");
    });
  });
});
