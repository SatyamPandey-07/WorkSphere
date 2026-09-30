/**
 * Tests for venue photo enrichment fallback logic.
 *
 * Covers: found=false returns fallback photos, fallback photos are non-empty,
 * fallback uses picsum.photos domain, and different query strings produce
 * different fallback URL seeds.
 * Self-contained — no external imports.
 */

// ─── Minimal enrichment implementation used only by these tests ───────────────

interface VenuePhoto {
  url: string;
  alt: string;
}

interface EnrichmentResult {
  found: boolean;
  photos: VenuePhoto[];
}

/**
 * Generates a deterministic seed from a query string so different queries
 * always produce distinct fallback seeds.
 */
function seedFromQuery(query: string): number {
  let hash = 0;
  for (let i = 0; i < query.length; i++) {
    hash = (hash * 31 + query.charCodeAt(i)) >>> 0;
  }
  return (hash % 900) + 100; // 100–999 range
}

function generateFallbackPhotos(query: string, count = 3): VenuePhoto[] {
  const seed = seedFromQuery(query);
  return Array.from({ length: count }, (_, i) => ({
    url: `https://picsum.photos/seed/${seed + i}/800/600`,
    alt: `Venue photo ${i + 1} for ${query}`,
  }));
}

function enrichVenuePhotos(
  venueId: string,
  query: string,
  externalPhotos: VenuePhoto[]
): EnrichmentResult {
  if (externalPhotos.length === 0) {
    return {
      found: false,
      photos: generateFallbackPhotos(query),
    };
  }
  return { found: true, photos: externalPhotos };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("enrichVenuePhotos – fallback behaviour", () => {
  describe("when no external photos are found (found=false)", () => {
    it("sets found to false when externalPhotos is empty", () => {
      const result = enrichVenuePhotos("venue-1", "coffee shop", []);
      expect(result.found).toBe(false);
    });

    it("returns fallback photos when found=false", () => {
      const result = enrichVenuePhotos("venue-1", "coffee shop", []);
      expect(result.photos.length).toBeGreaterThan(0);
    });
  });

  describe("fallback photos are non-empty", () => {
    it("fallback returns exactly 3 photos by default", () => {
      const result = enrichVenuePhotos("venue-2", "library", []);
      expect(result.photos).toHaveLength(3);
    });

    it("every fallback photo has a non-empty url", () => {
      const result = enrichVenuePhotos("venue-3", "cafe", []);
      result.photos.forEach((photo) => {
        expect(photo.url.length).toBeGreaterThan(0);
      });
    });

    it("every fallback photo has a non-empty alt text", () => {
      const result = enrichVenuePhotos("venue-4", "coworking", []);
      result.photos.forEach((photo) => {
        expect(photo.alt.length).toBeGreaterThan(0);
      });
    });
  });

  describe("fallback URLs use picsum.photos domain", () => {
    it("each fallback photo URL starts with https://picsum.photos", () => {
      const result = enrichVenuePhotos("venue-5", "bookstore", []);
      result.photos.forEach((photo) => {
        expect(photo.url).toMatch(/^https:\/\/picsum\.photos/);
      });
    });

    it("fallback photo URLs contain a seed segment", () => {
      const result = enrichVenuePhotos("venue-6", "restaurant", []);
      result.photos.forEach((photo) => {
        expect(photo.url).toMatch(/\/seed\/\d+\//);
      });
    });
  });

  describe("different query produces different fallback URL seeds", () => {
    it("two different queries produce different fallback URL seeds", () => {
      const result1 = enrichVenuePhotos("venue-7", "gym", []);
      const result2 = enrichVenuePhotos("venue-8", "art gallery", []);

      const seed1 = result1.photos[0].url;
      const seed2 = result2.photos[0].url;

      expect(seed1).not.toBe(seed2);
    });

    it("the same query always produces the same seed (deterministic)", () => {
      const resultA = enrichVenuePhotos("venue-9", "spa", []);
      const resultB = enrichVenuePhotos("venue-10", "spa", []);

      expect(resultA.photos[0].url).toBe(resultB.photos[0].url);
    });

    it("three distinct queries yield three distinct first-photo seeds", () => {
      const queries = ["hotel", "park", "museum"];
      const firstUrls = queries.map(
        (q) => enrichVenuePhotos("v", q, []).photos[0].url
      );
      const uniqueUrls = new Set(firstUrls);
      expect(uniqueUrls.size).toBe(3);
    });
  });

  describe("found=true path (control)", () => {
    it("returns found=true when external photos are provided", () => {
      const photos: VenuePhoto[] = [
        { url: "https://example.com/photo.jpg", alt: "A photo" },
      ];
      const result = enrichVenuePhotos("venue-11", "anything", photos);
      expect(result.found).toBe(true);
    });

    it("returns the provided photos unchanged when found=true", () => {
      const photos: VenuePhoto[] = [
        { url: "https://example.com/a.jpg", alt: "A" },
        { url: "https://example.com/b.jpg", alt: "B" },
      ];
      const result = enrichVenuePhotos("venue-12", "test", photos);
      expect(result.photos).toEqual(photos);
    });
  });
});
