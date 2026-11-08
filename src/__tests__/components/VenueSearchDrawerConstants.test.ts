import {
  TABLE_SIZES,
  EQUIPMENT_LOADOUTS,
  NOISE_LEVELS,
  AMENITIES_LIST,
  CATEGORIES_LIST,
} from "@/components/venues/VenueSearchDrawer";

describe("TABLE_SIZES", () => {
  it("has at least 4 options including 'all'", () => {
    expect(TABLE_SIZES.length).toBeGreaterThanOrEqual(4);
    expect(TABLE_SIZES.some((t) => t.id === "all")).toBe(true);
  });

  it("includes small, medium, large, xl sizes", () => {
    const ids = TABLE_SIZES.map((t) => t.id);
    expect(ids).toContain("small");
    expect(ids).toContain("medium");
    expect(ids).toContain("large");
    expect(ids).toContain("xl");
  });

  it("each entry has id and label", () => {
    TABLE_SIZES.forEach((t) => {
      expect(typeof t.id).toBe("string");
      expect(typeof t.label).toBe("string");
      expect(t.label.length).toBeGreaterThan(0);
    });
  });
});

describe("EQUIPMENT_LOADOUTS", () => {
  it("has minimal, standard, heavy options plus 'all'", () => {
    const ids = EQUIPMENT_LOADOUTS.map((e) => e.id);
    expect(ids).toContain("all");
    expect(ids).toContain("minimal");
    expect(ids).toContain("standard");
    expect(ids).toContain("heavy");
  });

  it("each entry has id and label", () => {
    EQUIPMENT_LOADOUTS.forEach((e) => {
      expect(typeof e.id).toBe("string");
      expect(typeof e.label).toBe("string");
    });
  });
});

describe("NOISE_LEVELS", () => {
  it("includes all, quiet, moderate, loud", () => {
    const ids = NOISE_LEVELS.map((n) => n.id);
    expect(ids).toContain("all");
    expect(ids).toContain("quiet");
    expect(ids).toContain("moderate");
    expect(ids).toContain("loud");
  });
});

describe("AMENITIES_LIST", () => {
  it("includes wifi and outlets", () => {
    const ids = AMENITIES_LIST.map((a) => a.id);
    expect(ids).toContain("wifi");
    expect(ids).toContain("outlets");
  });
});

describe("CATEGORIES_LIST", () => {
  it("includes all, cafe, coworking, library", () => {
    const ids = CATEGORIES_LIST.map((c) => c.id);
    expect(ids).toContain("all");
    expect(ids).toContain("cafe");
    expect(ids).toContain("coworking");
    expect(ids).toContain("library");
  });
});
