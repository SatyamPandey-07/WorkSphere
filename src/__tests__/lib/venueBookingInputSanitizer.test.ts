describe("Input sanitization", () => {
  function sanitizeText(s: string): string {
    return s.replace(/<[^>]*>/g, "").replace(/[^\w\s.,!?@-]/g, "").trim();
  }
  function sanitizePrice(v: unknown): number | null {
    const n = Number(v);
    return isNaN(n) || n < 0 ? null : Math.round(n * 100) / 100;
  }
  function sanitizeEmail(s: string): string {
    return s.toLowerCase().trim();
  }
  function isValidCapacity(n: number): boolean {
    return Number.isInteger(n) && n > 0 && n <= 10000;
  }
  it("strips HTML tags", () => { expect(sanitizeText("<script>alert('x')</script>Hello")).toBe("Hello"); });
  it("rejects negative price", () => { expect(sanitizePrice(-5)).toBeNull(); });
  it("accepts valid price", () => { expect(sanitizePrice("12.50")).toBe(12.5); });
  it("normalises email", () => { expect(sanitizeEmail("TEST@EXAMPLE.COM")).toBe("test@example.com"); });
  it("valid capacity 100", () => { expect(isValidCapacity(100)).toBe(true); });
  it("invalid capacity 0", () => { expect(isValidCapacity(0)).toBe(false); });
});
