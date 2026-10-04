describe("Validation rules for venue bookings", () => {
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const PHONE_RE = /^\+?[\d\s-]{7,15}$/;
  const DATE_RE  = /^\d{4}-\d{2}-\d{2}$/;
  function isValidEmail(s: string): boolean { return EMAIL_RE.test(s); }
  function isValidPhone(s: string): boolean { return PHONE_RE.test(s); }
  function isValidDate(s: string): boolean { return DATE_RE.test(s) && !isNaN(Date.parse(s)); }
  function isPositiveInt(n: number): boolean { return Number.isInteger(n) && n > 0; }
  function isInRange(n: number, min: number, max: number): boolean { return n >= min && n <= max; }
  it("valid email", () => { expect(isValidEmail("test@example.com")).toBe(true); });
  it("invalid email no @", () => { expect(isValidEmail("notanemail")).toBe(false); });
  it("valid phone", () => { expect(isValidPhone("+44123456789")).toBe(true); });
  it("valid date", () => { expect(isValidDate("2026-11-01")).toBe(true); });
  it("invalid date", () => { expect(isValidDate("01/11/2026")).toBe(false); });
  it("positive int", () => { expect(isPositiveInt(5)).toBe(true); });
  it("isInRange within bounds", () => { expect(isInRange(50, 1, 100)).toBe(true); });
});
