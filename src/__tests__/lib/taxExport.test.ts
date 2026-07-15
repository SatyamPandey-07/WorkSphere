import { resolveDateRange, filterBookingsByRange, computeTaxTotals } from "@/lib/taxExport";

describe("resolveDateRange", () => {
  it("resolves a tax year to Jan 1 - Dec 31", () => {
    expect(resolveDateRange({ taxYear: 2025 })).toEqual({
      start: "2025-01-01",
      end: "2025-12-31",
    });
  });

  it("resolves an explicit custom range", () => {
    expect(resolveDateRange({ startDate: "2025-03-01", endDate: "2025-06-30" })).toEqual({
      start: "2025-03-01",
      end: "2025-06-30",
    });
  });

  it("throws if startDate is after endDate", () => {
    expect(() =>
      resolveDateRange({ startDate: "2025-06-30", endDate: "2025-03-01" }),
    ).toThrow();
  });

  it("throws if neither taxYear nor a full range is given", () => {
    expect(() => resolveDateRange({})).toThrow();
  });
});

describe("filterBookingsByRange", () => {
  const bookings = [
    { date: "2025-01-15" },
    { date: "2025-06-01" },
    { date: "2024-12-31" },
    { date: "2026-01-01" },
  ];

  it("keeps only bookings within the inclusive range", () => {
    const result = filterBookingsByRange(bookings, { start: "2025-01-01", end: "2025-12-31" });
    expect(result).toEqual([{ date: "2025-01-15" }, { date: "2025-06-01" }]);
  });

  it("returns an empty array when nothing matches", () => {
    const result = filterBookingsByRange(bookings, { start: "2030-01-01", end: "2030-12-31" });
    expect(result).toEqual([]);
  });
});

describe("computeTaxTotals", () => {
  it("computes subtotal/tax/total using the flat $15/hr, 8% assumption", () => {
    const totals = computeTaxTotals([{ duration: 2 }, { duration: 1 }]);
    // (2*15 + 1*15) = 45 subtotal, 8% = 3.6 tax
    expect(totals.subtotal).toBe(45);
    expect(totals.tax).toBe(3.6);
    expect(totals.total).toBe(48.6);
    expect(totals.count).toBe(2);
  });

  it("defaults missing duration to 1 hour", () => {
    const totals = computeTaxTotals([{}]);
    expect(totals.subtotal).toBe(15);
  });
});
