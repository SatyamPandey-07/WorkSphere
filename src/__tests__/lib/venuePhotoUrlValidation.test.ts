// Self-contained tests for venue photo URL validation logic

function isValidVenuePhotoUrl(url: string): boolean {
  if (!url || url.trim() === "") return false;
  // Must be absolute HTTPS URL
  if (!url.startsWith("https://")) return false;
  // Block known disallowed sources
  const blockedHosts = ["source.unsplash.com"];
  try {
    const parsed = new URL(url);
    if (blockedHosts.includes(parsed.hostname)) return false;
  } catch {
    return false;
  }
  return true;
}

describe("venuePhotoUrlValidation - isValidVenuePhotoUrl", () => {
  describe("valid URLs", () => {
    it("accepts a valid https URL", () => {
      expect(isValidVenuePhotoUrl("https://example.com/photo.jpg")).toBe(true);
    });

    it("accepts picsum.photos HTTPS URLs", () => {
      expect(isValidVenuePhotoUrl("https://picsum.photos/800/600")).toBe(true);
      expect(isValidVenuePhotoUrl("https://picsum.photos/id/237/400/300")).toBe(
        true
      );
    });

    it("accepts images.unsplash.com HTTPS URLs", () => {
      expect(
        isValidVenuePhotoUrl(
          "https://images.unsplash.com/photo-abc?w=800&q=80"
        )
      ).toBe(true);
    });

    it("accepts any valid HTTPS image URL", () => {
      expect(
        isValidVenuePhotoUrl("https://cdn.worksphere.app/venues/hall.jpg")
      ).toBe(true);
    });
  });

  describe("invalid URLs - insecure or relative", () => {
    it("rejects plain http URLs (insecure)", () => {
      expect(isValidVenuePhotoUrl("http://example.com/photo.jpg")).toBe(false);
    });

    it("rejects relative URLs", () => {
      expect(isValidVenuePhotoUrl("/images/venue.jpg")).toBe(false);
      expect(isValidVenuePhotoUrl("images/venue.jpg")).toBe(false);
    });

    it("rejects empty string", () => {
      expect(isValidVenuePhotoUrl("")).toBe(false);
    });

    it("rejects whitespace-only string", () => {
      expect(isValidVenuePhotoUrl("   ")).toBe(false);
    });

    it("rejects protocol-relative URLs", () => {
      expect(isValidVenuePhotoUrl("//example.com/photo.jpg")).toBe(false);
    });
  });

  describe("blocked hosts", () => {
    it("blocks source.unsplash.com URLs", () => {
      expect(
        isValidVenuePhotoUrl(
          "https://source.unsplash.com/random/800x600"
        )
      ).toBe(false);
    });

    it("blocks source.unsplash.com even with path params", () => {
      expect(
        isValidVenuePhotoUrl("https://source.unsplash.com/featured/?cafes")
      ).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("rejects a data URI", () => {
      expect(
        isValidVenuePhotoUrl("data:image/png;base64,abc123")
      ).toBe(false);
    });

    it("rejects blob URLs", () => {
      expect(
        isValidVenuePhotoUrl("blob:https://app.worksphere.com/uuid-here")
      ).toBe(false);
    });
  });
});
