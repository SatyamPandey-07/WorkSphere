import {
  ACCENT_COLORS,
  ACCENT_HEX_MAP,
  ACCENT_OPTIONS,
  DEFAULT_ACCENT,
  parseAccentColor,
  type AccentColor,
} from "@/lib/constants/theme";

describe("Theme Constants (#6164)", () => {
  describe("parseAccentColor", () => {
    it("resolves 'lantern-emerald' correctly", () => {
      expect(parseAccentColor("lantern-emerald")).toBe("lantern-emerald");
    });

    it("resolves all standard accent colors", () => {
      expect(parseAccentColor("blue")).toBe("blue");
      expect(parseAccentColor("purple")).toBe("purple");
      expect(parseAccentColor("emerald")).toBe("emerald");
      expect(parseAccentColor("amber")).toBe("amber");
    });

    it("falls back to DEFAULT_ACCENT for null, empty string, or undefined-like inputs", () => {
      expect(parseAccentColor(null)).toBe(DEFAULT_ACCENT);
      expect(parseAccentColor("")).toBe(DEFAULT_ACCENT);
    });

    it("falls back to DEFAULT_ACCENT for invalid or unknown strings", () => {
      expect(parseAccentColor("random-color")).toBe(DEFAULT_ACCENT);
      expect(parseAccentColor("red")).toBe(DEFAULT_ACCENT);
      expect(parseAccentColor("LANTERN-EMERALD")).toBe(DEFAULT_ACCENT);
      expect(parseAccentColor("lantern")).toBe(DEFAULT_ACCENT);
    });
  });

  describe("ACCENT_COLORS['lantern-emerald'] configuration", () => {
    const lanternConfig = ACCENT_COLORS["lantern-emerald"];

    it("exists in ACCENT_COLORS map", () => {
      expect(lanternConfig).toBeDefined();
    });

    it("has the name 'lantern-emerald' and label 'Lantern Emerald'", () => {
      expect(lanternConfig.name).toBe("lantern-emerald");
      expect(lanternConfig.label).toBe("Lantern Emerald");
    });

    it("defines vibrant neon emerald hex values (#00ff88 / #10b981)", () => {
      expect(lanternConfig.hex).toBe("#00ff88");
      expect(lanternConfig.value).toBe("#00ff88");
    });

    it("defines dedicated light and dark mode hex tokens", () => {
      expect(lanternConfig.lightHex).toBe("#10b981");
      expect(lanternConfig.darkHex).toBe("#00ff88");
      expect(lanternConfig.modes).toEqual({
        light: "#10b981",
        dark: "#00ff88",
      });
    });

    it("specifies the --accent-lantern CSS variable token", () => {
      expect(lanternConfig.cssVar).toBe("--accent-lantern");
    });
  });

  describe("ACCENT_HEX_MAP and ACCENT_OPTIONS integration", () => {
    it("maps 'lantern-emerald' to '#00ff88' in ACCENT_HEX_MAP", () => {
      expect(ACCENT_HEX_MAP["lantern-emerald"]).toBe("#00ff88");
    });

    it("includes 'lantern-emerald' in ACCENT_OPTIONS list", () => {
      const option = ACCENT_OPTIONS.find((opt) => opt.name === "lantern-emerald");
      expect(option).toBeDefined();
      expect(option?.label).toBe("Lantern Emerald");
      expect(option?.hex).toBe("#00ff88");
    });

    it("contains 5 accent options total", () => {
      expect(ACCENT_OPTIONS).toHaveLength(5);
    });
  });
});
