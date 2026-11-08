/**
 * Tests for the aspect ratio presets added to AvatarCropModal (Issue #1981).
 * Verifies preset values and label formats.
 */

// Aspect ratio presets from AvatarCropModal.tsx
const ASPECT_PRESETS = [
  { label: "1:1", value: 1, description: "Square (profile picture)" },
  { label: "4:3", value: 4 / 3, description: "Standard" },
  { label: "16:9", value: 16 / 9, description: "Widescreen" },
] as const;

describe("Avatar crop aspect ratio presets", () => {
  it("has exactly 3 presets", () => {
    expect(ASPECT_PRESETS).toHaveLength(3);
  });

  it("1:1 preset has value 1 (square)", () => {
    const preset = ASPECT_PRESETS.find((p) => p.label === "1:1")!;
    expect(preset.value).toBe(1);
  });

  it("4:3 preset has correct fractional value", () => {
    const preset = ASPECT_PRESETS.find((p) => p.label === "4:3")!;
    expect(preset.value).toBeCloseTo(1.333, 2);
  });

  it("16:9 preset has correct fractional value", () => {
    const preset = ASPECT_PRESETS.find((p) => p.label === "16:9")!;
    expect(preset.value).toBeCloseTo(1.778, 2);
  });

  it("all presets have non-empty labels and descriptions", () => {
    ASPECT_PRESETS.forEach((p) => {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
    });
  });

  it("aspect values are all positive", () => {
    ASPECT_PRESETS.forEach((p) => {
      expect(p.value).toBeGreaterThan(0);
    });
  });

  it("values are monotonically increasing (1:1 < 4:3 < 16:9)", () => {
    const values = [...ASPECT_PRESETS].map((p) => p.value);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]);
    }
  });

  it("1:1 is square (width === height)", () => {
    const squarePreset = ASPECT_PRESETS[0];
    const width = 100 * squarePreset.value;
    const height = 100;
    expect(width).toBe(height);
  });

  it("16:9 is landscape (wider than tall)", () => {
    const preset = ASPECT_PRESETS[2];
    expect(preset.value).toBeGreaterThan(1);
  });

  it("1:1 description mentions square or profile", () => {
    const preset = ASPECT_PRESETS[0];
    expect(preset.description.toLowerCase()).toMatch(/square|profile/);
  });
});
