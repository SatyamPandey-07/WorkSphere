import { sanitizeCss, sanitizeSvg, sanitizeColor } from "@/lib/security/svgSanitizer";

describe("svgSanitizer", () => {
  it("guards non-string inputs in sanitizeCss without throwing TypeError", () => {
    expect(sanitizeCss(null as any)).toBe("");
    expect(sanitizeCss(undefined as any)).toBe("");
    expect(sanitizeCss(12345 as any)).toBe("");
  });

  it("sanitizes dangerous css expressions while leaving valid css intact", () => {
    expect(sanitizeCss("color: red; expression(alert(1));")).toBe("color: red; ");
    expect(sanitizeCss("background: url('javascript:alert(1)');")).toBe("background: ");
  });

  it("handles empty or non-string svg content gracefully", () => {
    expect(sanitizeSvg(null as any)).toBe("");
    expect(sanitizeSvg(undefined as any)).toBe("");
  });
});
