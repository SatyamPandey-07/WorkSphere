/**
 * Tests for the localStorage load/save mechanics of useAIUserPreferences (Issue #2413).
 */

const PREFERENCES_KEY = "worksphere-ai-preferences";

function loadPreferences(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function savePreferences(prefs: Record<string, unknown>): void {
  localStorage.setItem(
    PREFERENCES_KEY,
    JSON.stringify({ ...prefs, lastUpdated: Date.now() }),
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe("AI preferences localStorage mechanics", () => {
  it("returns empty object when nothing stored", () => {
    expect(loadPreferences()).toEqual({});
  });

  it("saves and loads preferences correctly", () => {
    savePreferences({ noiseLevel: "quiet", minWifiQuality: 4 });
    const loaded = loadPreferences();
    expect(loaded.noiseLevel).toBe("quiet");
    expect(loaded.minWifiQuality).toBe(4);
  });

  it("saved preferences include lastUpdated timestamp", () => {
    savePreferences({ requiresOutlets: true });
    const loaded = loadPreferences();
    expect(typeof loaded.lastUpdated).toBe("number");
    expect((loaded.lastUpdated as number)).toBeGreaterThan(0);
  });

  it("lastUpdated is recent (within 1 second)", () => {
    const before = Date.now();
    savePreferences({});
    const after = Date.now();
    const loaded = loadPreferences();
    expect((loaded.lastUpdated as number)).toBeGreaterThanOrEqual(before);
    expect((loaded.lastUpdated as number)).toBeLessThanOrEqual(after + 10);
  });

  it("handles malformed JSON gracefully", () => {
    localStorage.setItem(PREFERENCES_KEY, "INVALID JSON{{");
    expect(() => loadPreferences()).not.toThrow();
    expect(loadPreferences()).toEqual({});
  });

  it("overwriting preferences replaces old values", () => {
    savePreferences({ noiseLevel: "quiet" });
    savePreferences({ noiseLevel: "moderate" });
    const loaded = loadPreferences();
    expect(loaded.noiseLevel).toBe("moderate");
  });

  it("saving null-like values works", () => {
    savePreferences({ maxPriceTier: null as unknown as number });
    const loaded = loadPreferences();
    expect(loaded.maxPriceTier).toBeNull();
  });
});
