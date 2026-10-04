describe("Currency utilities for venue bookings", () => {
  function formatGBP(amount: number): string { return `£${amount.toFixed(2)}`; }
  function formatUSD(amount: number): string { return `$${amount.toFixed(2)}`; }
  function addVat(amount: number, rate = 0.2): number { return Math.round(amount * (1 + rate) * 100) / 100; }
  function removeVat(grossAmount: number, rate = 0.2): number { return Math.round(grossAmount / (1 + rate) * 100) / 100; }
  function splitAmount(total: number, parts: number): number[] {
    const each = Math.floor(total * 100 / parts) / 100;
    const remainder = Math.round((total - each * parts) * 100) / 100;
    return Array(parts).fill(each).map((v, i) => i === 0 ? Math.round((v + remainder) * 100) / 100 : v);
  }
  it("formatGBP £10.00", () => { expect(formatGBP(10)).toBe("£10.00"); });
  it("formatUSD $9.99", () => { expect(formatUSD(9.99)).toBe("$9.99"); });
  it("addVat 20% to £100 = £120", () => { expect(addVat(100)).toBe(120); });
  it("removeVat from £120 = £100", () => { expect(removeVat(120)).toBe(100); });
  it("splitAmount 3 ways total correct", () => {
    const parts = splitAmount(100, 3);
    expect(parts.reduce((s, p) => s + p, 0)).toBeCloseTo(100, 1);
  });
});
