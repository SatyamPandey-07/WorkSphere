import { VIBE_TAGS } from "@/components/VenueRatingDialog";

describe("VIBE_TAGS constant", () => {
  it("exports an array with at least 8 vibe tags", () => {
    expect(VIBE_TAGS.length).toBeGreaterThanOrEqual(8);
  });

  it("each tag has an id and label", () => {
    VIBE_TAGS.forEach((tag) => {
      expect(tag).toHaveProperty("id");
      expect(tag).toHaveProperty("label");
      expect(typeof tag.id).toBe("string");
      expect(typeof tag.label).toBe("string");
    });
  });

  it("includes COZY tag", () => {
    expect(VIBE_TAGS.some((t) => t.id === "COZY")).toBe(true);
  });

  it("includes INDUSTRIAL tag", () => {
    expect(VIBE_TAGS.some((t) => t.id === "INDUSTRIAL")).toBe(true);
  });

  it("includes PLANT_FILLED tag", () => {
    expect(VIBE_TAGS.some((t) => t.id === "PLANT_FILLED")).toBe(true);
  });

  it("all tag IDs are unique", () => {
    const ids = VIBE_TAGS.map((t) => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("all labels contain an emoji or descriptive text", () => {
    VIBE_TAGS.forEach((tag) => {
      expect(tag.label.length).toBeGreaterThan(2);
    });
  });
});
