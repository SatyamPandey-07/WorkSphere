import { venueRatingSchema } from "@/lib/validations";

describe("venueRatingSchema comment validation", () => {
  const baseData = {
    wifiQuality: 5,
    hasOutlets: true,
    noiseLevel: "quiet",
  };

  it("rejects whitespace-only comments", () => {
    const result = venueRatingSchema.safeParse({
      ...baseData,
      comment: "   ",
    });

    expect(result.success).toBe(false);
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
});
