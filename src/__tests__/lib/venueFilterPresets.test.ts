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
});
