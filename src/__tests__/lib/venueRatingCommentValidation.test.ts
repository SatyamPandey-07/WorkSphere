import { venueRatingSchema } from "@/lib/validations";

describe("venueRatingSchema comment validation", () => {
  const baseData = {
    wifiQuality: 5,
    hasOutlets: true,
    noiseLevel: "quiet",
  };

  it("accepts whitespace-only comments (becomes empty after sanitization)", () => {
    const result = venueRatingSchema.safeParse({
      ...baseData,
      comment: "   ",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.comment).toBe("");
    }
  });

  it("accepts and trims a valid comment", () => {
    const result = venueRatingSchema.safeParse({
      ...baseData,
      comment: "  Great place to work!  ",
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.comment).toBe("Great place to work!");
    }
  });

  it("rejects comments longer than 1000 characters", () => {
    const result = venueRatingSchema.safeParse({
      ...baseData,
      comment: "a".repeat(1001),
    });

    expect(result.success).toBe(false);
  });

  it("strips script tags from comment", () => {
    const result = venueRatingSchema.safeParse({
      ...baseData,
      comment: "<script>alert('xss')</script>",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.comment).not.toContain("<script>");
      expect(result.data.comment).not.toContain("alert");
    }
  });

  it("strips event handler attributes from comment", () => {
    const result = venueRatingSchema.safeParse({
      ...baseData,
      comment: '<img src=x onerror="alert(1)">',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.comment).not.toContain("onerror");
      expect(result.data.comment).not.toContain("alert");
    }
  });

  it("strips inline javascript: protocols", () => {
    const result = venueRatingSchema.safeParse({
      ...baseData,
      comment: "javascript:alert(1)",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.comment).not.toContain("javascript:");
    }
  });

  it("preserves valid plain text multi-line comments", () => {
    const result = venueRatingSchema.safeParse({
      ...baseData,
      comment: "Line 1\nLine 2\nLine 3",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.comment).toBe("Line 1\nLine 2\nLine 3");
    }
  });
});
