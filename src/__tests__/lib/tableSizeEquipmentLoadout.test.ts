/**
 * Tests for TABLE_SIZES and EQUIPMENT_LOADOUTS constants (Issue #2067).
 */

import {
  TABLE_SIZES,
  EQUIPMENT_LOADOUTS,
} from "@/components/venues/VenueSearchDrawer";

describe("TABLE_SIZES constant", () => {
  it("has 'all' as first option", () => {
    expect(TABLE_SIZES[0].id).toBe("all");
  });

  it("includes small, medium, large, xl sizes", () => {
    const ids = TABLE_SIZES.map((t) => t.id);
    expect(ids).toContain("small");
    expect(ids).toContain("medium");
    expect(ids).toContain("large");
    expect(ids).toContain("xl");
  });

  it("has 5 options (all + 4 sizes)", () => {
    expect(TABLE_SIZES).toHaveLength(5);
  });

  it("each option has non-empty label and id", () => {
    TABLE_SIZES.forEach((t) => {
      expect(t.id.length).toBeGreaterThan(0);
      expect(t.label.length).toBeGreaterThan(0);
    });
  });

  it("labels are descriptive (include size or capacity hint)", () => {
    const nonAllLabels = TABLE_SIZES.filter((t) => t.id !== "all");
    nonAllLabels.forEach((t) => {
      expect(t.label.length).toBeGreaterThan(5); // should be descriptive
    });
  });

  it("IDs are lowercase", () => {
    TABLE_SIZES.forEach((t) => {
      expect(t.id).toBe(t.id.toLowerCase());
    });
  });
});

describe("EQUIPMENT_LOADOUTS constant", () => {
  it("has 'all' as first option", () => {
    expect(EQUIPMENT_LOADOUTS[0].id).toBe("all");
  });

  it("includes minimal, standard, heavy loadouts", () => {
    const ids = EQUIPMENT_LOADOUTS.map((e) => e.id);
    expect(ids).toContain("minimal");
    expect(ids).toContain("standard");
    expect(ids).toContain("heavy");
  });

  it("has 4 options (all + 3 loadouts)", () => {
    expect(EQUIPMENT_LOADOUTS).toHaveLength(4);
  });

  it("minimal has the lowest requirement hint", () => {
    const minimal = EQUIPMENT_LOADOUTS.find((e) => e.id === "minimal")!;
    expect(minimal.label.toLowerCase()).toMatch(/minimal|laptop/i);
  });

  it("heavy has the highest requirement hint", () => {
    const heavy = EQUIPMENT_LOADOUTS.find((e) => e.id === "heavy")!;
    expect(heavy.label.toLowerCase()).toMatch(/heavy|dual|monitor|dock/i);
  });
});
