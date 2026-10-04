/**
 * Tests for venue booking cost center allocation and expense tracking.
 */

interface CostEntry {
  id: string;
  category: "venue_hire" | "catering" | "av_tech" | "staffing" | "marketing" | "admin" | "maintenance";
  amount: number;
  isFixed: boolean;         // fixed vs variable cost
  allocatedToCostCenter: string;
  bookingId: string | null; // null = overhead
  month: string;
}

function totalByCategory(entries: CostEntry[]): Record<CostEntry["category"], number> {
  const result: Partial<Record<CostEntry["category"], number>> = {};
  for (const e of entries) {
    result[e.category] = Math.round(((result[e.category] ?? 0) + e.amount) * 100) / 100;
  }
  return result as Record<CostEntry["category"], number>;
}

function fixedVsVariable(entries: CostEntry[]): { fixed: number; variable: number } {
  let fixed = 0; let variable = 0;
  for (const e of entries) {
    if (e.isFixed) fixed += e.amount;
    else variable += e.amount;
  }
  return { fixed: Math.round(fixed * 100) / 100, variable: Math.round(variable * 100) / 100 };
}

function overheadCosts(entries: CostEntry[]): number {
  return Math.round(entries.filter((e) => e.bookingId === null).reduce((s, e) => s + e.amount, 0) * 100) / 100;
}

function costPerBooking(entries: CostEntry[], bookingCount: number): number {
  if (bookingCount === 0) return 0;
  const direct = entries.filter((e) => e.bookingId !== null).reduce((s, e) => s + e.amount, 0);
  return Math.round((direct / bookingCount) * 100) / 100;
}

function costCenterTotal(entries: CostEntry[], costCenter: string): number {
  return Math.round(entries.filter((e) => e.allocatedToCostCenter === costCenter).reduce((s, e) => s + e.amount, 0) * 100) / 100;
}

const ENTRIES: CostEntry[] = [
  { id: "c1", category: "venue_hire",  amount: 5000, isFixed: true,  allocatedToCostCenter: "ops",       bookingId: "b1",  month: "2026-09" },
  { id: "c2", category: "catering",    amount: 1200, isFixed: false, allocatedToCostCenter: "ops",       bookingId: "b1",  month: "2026-09" },
  { id: "c3", category: "marketing",   amount: 800,  isFixed: false, allocatedToCostCenter: "marketing", bookingId: null,  month: "2026-09" },
  { id: "c4", category: "admin",       amount: 500,  isFixed: true,  allocatedToCostCenter: "admin",     bookingId: null,  month: "2026-09" },
  { id: "c5", category: "staffing",    amount: 2000, isFixed: false, allocatedToCostCenter: "ops",       bookingId: "b2",  month: "2026-09" },
];

describe("Cost center allocation and expense tracking", () => {
  it("totalByCategory: venue_hire = $5000", () => {
    expect(totalByCategory(ENTRIES).venue_hire).toBe(5000);
  });

  it("fixedVsVariable: fixed $5500, variable $4000", () => {
    const fv = fixedVsVariable(ENTRIES);
    expect(fv.fixed).toBe(5500);
    expect(fv.variable).toBe(4000);
  });

  it("overheadCosts: marketing + admin = $1300", () => {
    expect(overheadCosts(ENTRIES)).toBe(1300);
  });

  it("costPerBooking: (5000+1200+2000) / 2 = $4100", () => {
    expect(costPerBooking(ENTRIES, 2)).toBe(4100);
  });

  it("costCenterTotal: ops = $8200", () => {
    expect(costCenterTotal(ENTRIES, "ops")).toBe(8200);
  });
});
