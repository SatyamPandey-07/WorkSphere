/**
 * Tests for smart pricing calendar with day-level pricing.
 */

type DayPricingStatus = "standard" | "peak" | "off_peak" | "blackout" | "promo";

interface CalendarPricingRule {
  date: string;         // YYYY-MM-DD
  status: DayPricingStatus;
  multiplier: number;   // price multiplier
  note?: string;
}

interface PricingCalendar {
  venueId: string;
  baseRateCents: number;
  rules: CalendarPricingRule[];
  defaultMultiplier: number;
}

function getDayMultiplier(calendar: PricingCalendar, date: string): number {
  const rule = calendar.rules.find((r) => r.date === date);
  return rule ? rule.multiplier : calendar.defaultMultiplier;
}

function getDayPrice(calendar: PricingCalendar, date: string): number {
  const multiplier = getDayMultiplier(calendar, date);
  return Math.round(calendar.baseRateCents * multiplier);
}

function isDayBookable(calendar: PricingCalendar, date: string): boolean {
  const rule = calendar.rules.find((r) => r.date === date);
  return !rule || rule.status !== "blackout";
}

function priceForDateRange(
  calendar: PricingCalendar,
  startDate: string,
  endDate: string
): number {
  let total = 0;
  const current = new Date(startDate);
  const end = new Date(endDate);

  while (current <= end) {
    const dateStr = current.toISOString().split("T")[0];
    if (!isDayBookable(calendar, dateStr)) {
      return -1; // Range contains blackout
    }
    total += getDayPrice(calendar, dateStr);
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return total;
}

function cheapestWeek(calendar: PricingCalendar, monthStr: string): string | null {
  let minTotal = Infinity;
  let cheapestStart: string | null = null;

  const year = parseInt(monthStr.split("-")[0]);
  const month = parseInt(monthStr.split("-")[1]) - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let day = 1; day <= daysInMonth - 6; day++) {
    const startDate = `${monthStr}-${String(day).padStart(2, "0")}`;
    const endDate = new Date(new Date(startDate).getTime() + 6 * 86_400_000).toISOString().split("T")[0];
    const total = priceForDateRange(calendar, startDate, endDate);
    if (total !== -1 && total < minTotal) {
      minTotal = total;
      cheapestStart = startDate;
    }
  }

  return cheapestStart;
}

const CALENDAR: PricingCalendar = {
  venueId: "v1", baseRateCents: 1000, defaultMultiplier: 1.0,
  rules: [
    { date: "2026-10-15", status: "peak",     multiplier: 1.5, note: "Conference week" },
    { date: "2026-10-16", status: "peak",     multiplier: 1.5 },
    { date: "2026-10-25", status: "blackout", multiplier: 0,   note: "Maintenance" },
    { date: "2026-10-31", status: "promo",    multiplier: 0.7, note: "Halloween promo" },
  ],
};

describe("Smart pricing calendar", () => {
  it("getDayMultiplier: peak day = 1.5", () => {
    expect(getDayMultiplier(CALENDAR, "2026-10-15")).toBe(1.5);
  });

  it("getDayMultiplier: no rule = default 1.0", () => {
    expect(getDayMultiplier(CALENDAR, "2026-10-01")).toBe(1.0);
  });

  it("getDayPrice: standard day = 1000", () => {
    expect(getDayPrice(CALENDAR, "2026-10-01")).toBe(1000);
  });

  it("getDayPrice: peak day = 1500", () => {
    expect(getDayPrice(CALENDAR, "2026-10-15")).toBe(1500);
  });

  it("isDayBookable: standard → true", () => {
    expect(isDayBookable(CALENDAR, "2026-10-01")).toBe(true);
  });

  it("isDayBookable: blackout → false", () => {
    expect(isDayBookable(CALENDAR, "2026-10-25")).toBe(false);
  });

  it("priceForDateRange: contains blackout → -1", () => {
    expect(priceForDateRange(CALENDAR, "2026-10-24", "2026-10-26")).toBe(-1);
  });

  it("priceForDateRange: valid range = sum", () => {
    const total = priceForDateRange(CALENDAR, "2026-10-01", "2026-10-03");
    expect(total).toBe(3000); // 3 standard days × 1000
  });
});
