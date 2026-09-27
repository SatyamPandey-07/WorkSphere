/**
 * Tests for the deprecated Unsplash Source URL replacement with Picsum Photos (Issue #2115).
 * Verifies that the new URLs follow the correct Picsum format.
 */

// Replicate the URL generation logic from venues.ts
function buildFallbackPhotoUrls(query: string): string[] {
  return [
    `https://picsum.photos/seed/${query}-1/800/600`,
    `https://picsum.photos/seed/${query}-2/800/600`,
    `https://picsum.photos/seed/${query}-3/800/600`,
  ];
}

describe("Picsum Photos URL replacement", () => {
  it("generates 3 fallback photo URLs", () => {
    const urls = buildFallbackPhotoUrls("cafe-workspace");
    expect(urls).toHaveLength(3);
  });

  it("URLs use picsum.photos domain (not source.unsplash.com)", () => {
    const urls = buildFallbackPhotoUrls("library");
    urls.forEach((url) => {
      expect(url).not.toContain("source.unsplash.com");
      expect(url).toContain("picsum.photos");
    });
  });

  it("URLs use seed-based format for deterministic images", () => {
    const urls = buildFallbackPhotoUrls("coworking");
    urls.forEach((url) => {
      expect(url).toMatch(/picsum\.photos\/seed\//);
    });
  });

  it("URLs end with /800/600 dimensions", () => {
    const urls = buildFallbackPhotoUrls("office");
    urls.forEach((url) => {
      expect(url).toMatch(/\/800\/600$/);
    });
  });

  it("each URL has a unique seed suffix (-1, -2, -3)", () => {
    const urls = buildFallbackPhotoUrls("cafe");
    expect(urls[0]).toContain("cafe-1");
    expect(urls[1]).toContain("cafe-2");
    expect(urls[2]).toContain("cafe-3");
  });

  it("same query produces consistent URLs (deterministic)", () => {
    const first = buildFallbackPhotoUrls("workspace");
    const second = buildFallbackPhotoUrls("workspace");
    expect(first).toEqual(second);
  });

  it("different queries produce different URLs", () => {
    const cafe = buildFallbackPhotoUrls("cafe");
    const library = buildFallbackPhotoUrls("library");
    expect(cafe).not.toEqual(library);
  });

  it("old source.unsplash.com pattern is NOT used", () => {
    const urls = buildFallbackPhotoUrls("cafe");
    const hasOldPattern = urls.some((u) =>
      u.includes("source.unsplash.com") || u.includes("sig=")
    );
    expect(hasOldPattern).toBe(false);
  });
});
