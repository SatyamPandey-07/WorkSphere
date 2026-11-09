import {
  resolveDateRange,
  filterBookingsByRange,
  computeTaxTotals,
  taxBookingsToCSV,
  bookingsToCSV,
  generateTaxExportPdf,
} from "@/lib/taxExport";

import { exportBookingsToJson } from "@/lib/pdfHelpers";

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

    expect(totals.subtotal).toBe(45);
    expect(totals.tax).toBe(3.6);
    expect(totals.total).toBe(48.6);
    expect(totals.count).toBe(2);
  });

  it("defaults missing duration to 60 minutes (1 hour)", () => {
    const totals = computeTaxTotals([{}]);
    expect(totals.subtotal).toBe(15);
  });

  it("clamps zero and negative durations to zero hours", () => {
    const zeroTotals = computeTaxTotals([{ duration: 0 }]);
    expect(zeroTotals.subtotal).toBe(0);
    expect(zeroTotals.tax).toBe(0);
    expect(zeroTotals.total).toBe(0);

    const negativeTotals = computeTaxTotals([{ duration: -120 }]);
    expect(negativeTotals.subtotal).toBe(0);
    expect(negativeTotals.tax).toBe(0);
    expect(negativeTotals.total).toBe(0);
  });
});

describe("exportBookingsToJson", () => {
  it("exports bookings as formatted JSON", () => {
    const bookings = [
      {
        id: "booking-1",
        confirmationId: "CONF123",
        date: "2025-05-10",
        time: "10:00",
        duration: 60,
        projectBillingCode: "PROJECT-001",
        venue: {
          name: "Test Venue",
          category: "Meeting Room",
          address: "123 Test Street",
        },
      },
    ];

    const result = exportBookingsToJson(bookings);

    expect(JSON.parse(result)).toEqual(bookings);
    expect(result).toContain("\n");
  });

  it("exports an empty bookings array as valid JSON", () => {
    const result = exportBookingsToJson([]);

    expect(JSON.parse(result)).toEqual([]);
  });
});

describe("taxExport input sanitization and edge cases (#6754 & #6790)", () => {
  it("resolveDateRange throws structured error on nullish or non-object input", () => {
    expect(() => resolveDateRange(null)).toThrow("Either taxYear or both startDate and endDate are required");
    expect(() => resolveDateRange(undefined)).toThrow("Either taxYear or both startDate and endDate are required");
  });

  it("resolveDateRange parses string tax year correctly", () => {
    expect(resolveDateRange({ taxYear: " 2026 " })).toEqual({
      start: "2026-01-01",
      end: "2026-12-31",
    });
  });

  it("filterBookingsByRange safely handles nullish bookings or range", () => {
    expect(filterBookingsByRange(null as any, { start: "2025-01-01", end: "2025-12-31" })).toEqual([]);
    expect(filterBookingsByRange([{ date: "2025-05-01" }], null as any)).toEqual([]);
  });

  it("filterBookingsByRange handles nullish items and ISO date strings", () => {
    const list = [
      null as any,
      { date: null as any },
      { date: "2025-05-10T14:30:00Z" },
      { date: "2024-01-01" },
    ];
    const filtered = filterBookingsByRange(list, { start: "2025-01-01", end: "2025-12-31" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.date).toBe("2025-05-10T14:30:00Z");
  });

  it("computeTaxTotals safely handles nullish or non-array inputs", () => {
    expect(computeTaxTotals(null)).toEqual({ subtotal: 0, tax: 0, total: 0, count: 0 });
    expect(computeTaxTotals(undefined)).toEqual({ subtotal: 0, tax: 0, total: 0, count: 0 });
  });

  it("computeTaxTotals handles null elements and NaN durations safely", () => {
    const totals = computeTaxTotals([
      null,
      { duration: 2 },
      { duration: NaN }, // defaults to 1 hr
    ]);
    expect(totals.count).toBe(2);
    expect(totals.subtotal).toBe(45); // (2 * 15) + (1 * 15) = 45
    expect(totals.tax).toBe(3.6);
    expect(totals.total).toBe(48.6);
  });

  it("taxBookingsToCSV handles nullish or empty bookings array gracefully", () => {
    expect(taxBookingsToCSV(null)).toBe("");
    expect(taxBookingsToCSV([])).toBe("");
  });

  it("bookingsToCSV outputs RFC-4180 CRLF line endings and bills 0-minute duration as $0.00", () => {
    const csv = bookingsToCSV([
      {
        id: "b1",
        confirmationId: "CONF-001",
        date: "2026-10-26",
        time: "10:00",
        duration: 0,
        projectBillingCode: "PROJ-ZERO",
        venue: {
          name: "WeWork",
          category: "Desk",
          address: "123 St",
        },
      },
    ]);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("Confirmation ID,Venue,Category,Address,Date,Time,Billing Code,Price ($),Tax ($),Total ($)");
    expect(lines[1]).toContain("CONF-001,WeWork,Desk,123 St,2026-10-26,10:00,PROJ-ZERO,0.00,0.00,0.00");
  });

  it("generateTaxExportPdf handles nullish bookings and empty arrays without throwing", async () => {
    const pdfNull = await generateTaxExportPdf(null);
    expect(pdfNull).toBeInstanceOf(Uint8Array);
    expect(pdfNull.length).toBeGreaterThan(0);

    const pdfEmpty = await generateTaxExportPdf([]);
    expect(pdfEmpty).toBeInstanceOf(Uint8Array);
    expect(pdfEmpty.length).toBeGreaterThan(0);

    const pdfWithItems = await generateTaxExportPdf([
      null,
      {
        id: "b-test",
        date: "2026-10-26",
        time: "11:00",
        duration: 0,
        venue: { name: "Test Venue" },
      },
    ]);
    expect(pdfWithItems).toBeInstanceOf(Uint8Array);
    expect(pdfWithItems.length).toBeGreaterThan(0);
  });
});
