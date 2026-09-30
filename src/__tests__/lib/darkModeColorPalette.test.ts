/**
 * Tests for dark mode color palette token validation.
 */

interface ColorToken {
  name: string;
  lightValue: string;
  darkValue: string;
}

function isValidHex(value: string): boolean {
  return /^#([A-Fa-f0-9]{3}|[A-Fa-f0-9]{6})$/.test(value);
}

function validatePalette(tokens: ColorToken[]): string[] {
  const errors: string[] = [];
  for (const token of tokens) {
    if (!isValidHex(token.lightValue)) errors.push(`${token.name}: invalid light value '${token.lightValue}'`);
    if (!isValidHex(token.darkValue))  errors.push(`${token.name}: invalid dark value '${token.darkValue}'`);
    if (token.lightValue === token.darkValue) errors.push(`${token.name}: light and dark values are identical`);
  }
  return errors;
}

function getTokenValue(token: ColorToken, isDark: boolean): string {
  return isDark ? token.darkValue : token.lightValue;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = hex.replace(/^#/, "").match(/^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!match) return null;
  return { r: parseInt(match[1], 16), g: parseInt(match[2], 16), b: parseInt(match[3], 16) };
}

const TOKENS: ColorToken[] = [
  { name: "background", lightValue: "#FFFFFF", darkValue: "#1A1A2E"  },
  { name: "text",       lightValue: "#111111", darkValue: "#E0E0E0"  },
  { name: "accent",     lightValue: "#6366F1", darkValue: "#818CF8"  },
];

describe("Dark mode color palette", () => {
  it("isValidHex: 6-char hex", () => {
    expect(isValidHex("#FFFFFF")).toBe(true);
  });

  it("isValidHex: 3-char shorthand", () => {
    expect(isValidHex("#FFF")).toBe(true);
  });

  it("isValidHex: no # prefix → false", () => {
    expect(isValidHex("FFFFFF")).toBe(false);
  });

  it("isValidHex: wrong length → false", () => {
    expect(isValidHex("#FFFFF")).toBe(false);
  });

  it("validatePalette: valid tokens → no errors", () => {
    expect(validatePalette(TOKENS)).toHaveLength(0);
  });

  it("validatePalette: identical light/dark → error", () => {
    const bad: ColorToken = { name: "same", lightValue: "#FF0000", darkValue: "#FF0000" };
    expect(validatePalette([bad]).some((e) => /identical/i.test(e))).toBe(true);
  });

  it("getTokenValue: light mode returns lightValue", () => {
    expect(getTokenValue(TOKENS[0], false)).toBe("#FFFFFF");
  });

  it("getTokenValue: dark mode returns darkValue", () => {
    expect(getTokenValue(TOKENS[0], true)).toBe("#1A1A2E");
  });

  it("hexToRgb: #FFFFFF → {255,255,255}", () => {
    expect(hexToRgb("#FFFFFF")).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("hexToRgb: invalid → null", () => {
    expect(hexToRgb("#GGG")).toBeNull();
  });
});
