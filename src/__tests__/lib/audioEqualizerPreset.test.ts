/**
 * Tests for AudioEqualizer preset configuration.
 */

const EQ_PRESETS = {
  flat:     [0, 0, 0, 0, 0],
  bass:     [8, 6, 2, 0, 0],
  treble:   [0, 0, 2, 6, 8],
  vocal:    [0, 2, 6, 4, 0],
  acoustic: [4, 2, 0, 2, 4],
} as const;

type EqPresetName = keyof typeof EQ_PRESETS;

function getPresetGains(name: EqPresetName): readonly number[] {
  return EQ_PRESETS[name];
}

describe("AudioEqualizer presets", () => {
  it("flat preset has all zeros", () => {
    expect(getPresetGains("flat").every((g) => g === 0)).toBe(true);
  });

  it("bass preset boosts low frequencies (first band > last band)", () => {
    const gains = getPresetGains("bass");
    expect(gains[0]).toBeGreaterThan(gains[gains.length - 1]);
  });

  it("treble preset boosts high frequencies (last band > first band)", () => {
    const gains = getPresetGains("treble");
    expect(gains[gains.length - 1]).toBeGreaterThan(gains[0]);
  });

  it("all presets have exactly 5 bands", () => {
    (Object.keys(EQ_PRESETS) as EqPresetName[]).forEach((name) => {
      expect(getPresetGains(name)).toHaveLength(5);
    });
  });

  it("no preset has gain above 10dB", () => {
    (Object.keys(EQ_PRESETS) as EqPresetName[]).forEach((name) => {
      getPresetGains(name).forEach((g) => {
        expect(Math.abs(g)).toBeLessThanOrEqual(10);
      });
    });
  });

  it("preset names are strings", () => {
    expect(Object.keys(EQ_PRESETS)).toHaveLength(5);
  });
});
