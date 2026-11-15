import {
  loadFilterPresets,
  saveFilterPreset,
  deleteFilterPreset,
  DEFAULT_FILTER_PRESETS,
  FILTER_PRESETS_STORAGE_KEY,
} from "@/lib/venueFilterPresets";

describe("venueFilterPresets utility", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("loads default presets when localStorage is empty", () => {
    const presets = loadFilterPresets();
    expect(presets.length).toBeGreaterThanOrEqual(DEFAULT_FILTER_PRESETS.length);
    expect(presets.some((p) => p.name === "Quiet Study")).toBe(true);
    expect(presets.some((p) => p.name === "Cafe Vibe")).toBe(true);
    expect(presets.some((p) => p.name === "Team Collab")).toBe(true);
  });

  it("saves a new preset to localStorage and returns updated list", () => {
    const customFilters = {
      searchText: "WorkSpace Central",
      amenities: ["wifi", "ergonomic"],
      noiseLevel: "quiet",
      priceRange: "$$",
      category: "coworking",
      maxDistance: 3,
    };

    const updated = saveFilterPreset("My Focus Setup", customFilters);
    expect(updated.length).toBe(DEFAULT_FILTER_PRESETS.length + 1);

    const saved = updated.find((p) => p.name === "My Focus Setup");
    expect(saved).toBeDefined();
    expect(saved?.filters.searchText).toBe("WorkSpace Central");
    expect(saved?.filters.amenities).toEqual(["wifi", "ergonomic"]);
    expect(saved?.isDefault).toBe(false);

    // Verify stored in localStorage
    const storedRaw = localStorage.getItem(FILTER_PRESETS_STORAGE_KEY);
    expect(storedRaw).not.toBeNull();
    const parsed = JSON.parse(storedRaw!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("My Focus Setup");
  });

  it("deletes a custom preset from localStorage by ID", () => {
    const updated = saveFilterPreset("Temporary Preset", {
      amenities: ["wifi"],
      noiseLevel: "all",
      priceRange: "all",
      category: "all",
      maxDistance: 0,
    });

    const custom = updated.find((p) => p.name === "Temporary Preset");
    expect(custom).toBeDefined();

    const afterDelete = deleteFilterPreset(custom!.id);
    expect(afterDelete.some((p) => p.id === custom!.id)).toBe(false);
    expect(afterDelete.length).toBe(DEFAULT_FILTER_PRESETS.length);
  });

  it("gracefully handles corrupted JSON in localStorage", () => {
    localStorage.setItem(FILTER_PRESETS_STORAGE_KEY, "{ invalid json }");
    const presets = loadFilterPresets();
    expect(presets.length).toBe(DEFAULT_FILTER_PRESETS.length);
  });

  describe("Input Sanitization & Corrupt State Resilience (#6752)", () => {
    it("saveFilterPreset handles nullish name and nullish filters safely", () => {
      const updated = saveFilterPreset(null as any, null as any);
      const saved = updated.find((p) => p.name === "My Preset");
      expect(saved).toBeDefined();
      expect(saved?.filters.amenities).toEqual([]);
      expect(saved?.filters.maxDistance).toBe(0);
      expect(saved?.filters.noiseLevel).toBe("all");
    });

    it("saveFilterPreset sanitizes NaN maxDistance and clamps weights", () => {
      const updated = saveFilterPreset("Math Edge Cases", {
        amenities: ["wifi", "  ", null as any],
        noiseLevel: "quiet",
        priceRange: "$$",
        category: "cafe",
        maxDistance: NaN,
        semanticWeight: 2.5,
        fullTextWeight: -0.5,
      });

      const saved = updated.find((p) => p.name === "Math Edge Cases");
      expect(saved).toBeDefined();
      expect(saved?.filters.amenities).toEqual(["wifi"]);
      expect(saved?.filters.maxDistance).toBe(0);
      expect(saved?.filters.semanticWeight).toBe(1);
      expect(saved?.filters.fullTextWeight).toBe(0);
    });

    it("loadFilterPresets rejects corrupt filters and default ID spoofing", () => {
      const corruptData = [
        { id: "preset-quiet-study", name: "Spoofed Default", filters: {} }, // default ID collision
        { id: "preset-1", name: "Corrupt String Filters", filters: "invalid string" }, // non-object filters
        { id: "preset-2", name: "Missing ID", filters: {} }, // missing ID
        { id: "preset-valid", name: "Valid Custom", filters: { amenities: ["wifi"], maxDistance: 4 } },
      ];

      localStorage.setItem(FILTER_PRESETS_STORAGE_KEY, JSON.stringify(corruptData));
      const presets = loadFilterPresets();

      // Only valid custom preset should be added
      expect(presets.some((p) => p.name === "Spoofed Default")).toBe(false);
      expect(presets.some((p) => p.name === "Corrupt String Filters")).toBe(false);
      const custom = presets.find((p) => p.id === "preset-valid");
      expect(custom).toBeDefined();
      expect(custom?.filters.maxDistance).toBe(4);
    });

    it("deleteFilterPreset protects default presets and handles nullish IDs", () => {
      const initialCount = loadFilterPresets().length;
      expect(deleteFilterPreset("preset-quiet-study").length).toBe(initialCount);
      expect(deleteFilterPreset(null as any).length).toBe(initialCount);
      expect(deleteFilterPreset("").length).toBe(initialCount);
    });

    it("saveFilterPreset updates in place for duplicate case-insensitive name", () => {
      saveFilterPreset("Duplicate Test", {
        amenities: ["wifi"],
        noiseLevel: "quiet",
        priceRange: "$",
        category: "cafe",
        maxDistance: 1,
      });

      const updated = saveFilterPreset("duplicate test", {
        amenities: ["outlets"],
        noiseLevel: "moderate",
        priceRange: "$$",
        category: "coworking",
        maxDistance: 5,
      });

      const matches = updated.filter((p) => p.name.toLowerCase() === "duplicate test");
      expect(matches).toHaveLength(1);
      expect(matches[0].filters.amenities).toEqual(["outlets"]);
      expect(matches[0].filters.maxDistance).toBe(5);
    });
  });

});
