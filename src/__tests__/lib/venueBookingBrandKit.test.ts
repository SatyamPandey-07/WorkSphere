/**
 * Tests for venue brand kit validation and white-label customization utilities.
 */

interface BrandColor {
  hex: string;
  name: string;
  usage: "primary" | "secondary" | "accent" | "background" | "text";
}

interface BrandKit {
  venueId: string;
  primaryColor: string;
  secondaryColor: string;
  fontFamily: string;
  logoUrl: string;
  faviconUrl: string;
  brandName: string;
  tagline: string;
  colors: BrandColor[];
}

function isValidHex(hex: string): boolean {
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(hex);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace("#", "");
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16),
      g: parseInt(clean[1] + clean[1], 16),
      b: parseInt(clean[2] + clean[2], 16),
    };
  }
  if (clean.length === 6) {
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16),
    };
  }
  return null;
}

function luminance(hex: string): number | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return Math.round((0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b));
}

function isAccessibleContrast(foreground: string, background: string, minLuminanceDiff = 125): boolean {
  const fg = luminance(foreground);
  const bg = luminance(background);
  if (fg === null || bg === null) return false;
  return Math.abs(fg - bg) >= minLuminanceDiff;
}

function validateBrandKit(kit: BrandKit): string[] {
  const errors: string[] = [];
  if (!isValidHex(kit.primaryColor)) errors.push("Invalid primary color");
  if (!isValidHex(kit.secondaryColor)) errors.push("Invalid secondary color");
  if (!kit.brandName.trim()) errors.push("Brand name required");
  if (!kit.logoUrl.startsWith("https://")) errors.push("Logo URL must be HTTPS");
  return errors;
}

const BRAND: BrandKit = {
  venueId: "v1", primaryColor: "#0A2540", secondaryColor: "#635BFF",
  fontFamily: "Inter", logoUrl: "https://cdn.venue.com/logo.png",
  faviconUrl: "https://cdn.venue.com/favicon.ico", brandName: "Grand Hall",
  tagline: "Where moments become memories",
  colors: [
    { hex: "#0A2540", name: "Navy", usage: "primary" },
    { hex: "#635BFF", name: "Purple", usage: "accent" },
    { hex: "#FFFFFF", name: "White", usage: "background" },
  ],
};

describe("Brand kit validation", () => {
  it("isValidHex: #0A2540 → valid", () => {
    expect(isValidHex("#0A2540")).toBe(true);
  });

  it("isValidHex: #ABC → valid (shorthand)", () => {
    expect(isValidHex("#ABC")).toBe(true);
  });

  it("isValidHex: 0A2540 (no hash) → invalid", () => {
    expect(isValidHex("0A2540")).toBe(false);
  });

  it("hexToRgb: #FFFFFF = { r:255, g:255, b:255 }", () => {
    expect(hexToRgb("#FFFFFF")).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("isAccessibleContrast: dark on white → accessible", () => {
    expect(isAccessibleContrast("#000000", "#FFFFFF")).toBe(true);
  });

  it("validateBrandKit: valid brand → no errors", () => {
    expect(validateBrandKit(BRAND).length).toBe(0);
  });

  it("validateBrandKit: missing brand name → error", () => {
    expect(validateBrandKit({ ...BRAND, brandName: "" }).length).toBeGreaterThan(0);
  });
});
