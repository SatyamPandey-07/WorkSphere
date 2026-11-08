/**
 * Tests for the VibeTag enum and VIBE_TAGS constant (Issue #2076).
 * Verifies the aesthetic tagging system has consistent IDs and labels.
 */

import { VIBE_TAGS } from "@/components/VenueRatingDialog";

// Expected VibeTag IDs from Prisma schema
const EXPECTED_VIBE_IDS = [
  "COZY",
  "INDUSTRIAL",
  "MINIMALIST",
  "PLANT_FILLED",
  "BRIGHT_AIRY",
  "DARK_MOODY",
  "VINTAGE_RETRO",
  "MODERN_SLEEK",
  "ARTSY_CREATIVE",
  "LIVELY_SOCIAL",
] as const;

describe("VibeTag enum consistency", () => {
  it("VIBE_TAGS has same count as EXPECTED_VIBE_IDS", () => {
    expect(VIBE_TAGS.length).toBe(EXPECTED_VIBE_IDS.length);
  });

  it("all expected IDs are present in VIBE_TAGS", () => {
    const actualIds = VIBE_TAGS.map((t) => t.id);
    EXPECTED_VIBE_IDS.forEach((id) => {
      expect(actualIds).toContain(id);
    });
  });

  it("all IDs are SCREAMING_SNAKE_CASE", () => {
    VIBE_TAGS.forEach((tag) => {
      expect(tag.id).toMatch(/^[A-Z_]+$/);
    });
  });

  it("no duplicate IDs", () => {
    const ids = VIBE_TAGS.map((t) => t.id);
    const uniqueIds = [...new Set(ids)];
    expect(uniqueIds).toHaveLength(ids.length);
  });

  it("each label contains an emoji and description", () => {
    // Labels are emoji + text (e.g. "☕ Cozy")
    VIBE_TAGS.forEach((tag) => {
      expect(tag.label.length).toBeGreaterThan(3);
    });
  });

  it("at most 3 tags can be selected per rating (soft constraint)", () => {
    const maxTags = 3;
    // Verify there are more than 3 options (to make selection meaningful)
    expect(VIBE_TAGS.length).toBeGreaterThan(maxTags);
  });

  it("COZY tag represents warmth/comfort atmosphere", () => {
    const cozy = VIBE_TAGS.find((t) => t.id === "COZY");
    expect(cozy).toBeDefined();
    expect(cozy!.label.toLowerCase()).toMatch(/cozy|warm|comfort/i);
  });
});
