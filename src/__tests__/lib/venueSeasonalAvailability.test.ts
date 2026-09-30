/**
 * Tests for venue seasonal availability and blackout periods.
 */

interface SeasonalAvailability {
  venueId: string;
  availableMonths: number[];   // 1-12
  blackoutDates: string[];     // YYYY-MM-DD
  reducedHoursMonths: number[];// reduced hours (e.g., Dec/Jan)
}

function isAvailableInMonth(avail: SeasonalAvailability, month: number): boolean {
  return avail.availableMonths.includes(month);
}

function isBlackedOut(avail: SeasonalAvailability, date: string): boolean {
  return avail.blackoutDates.includes(date);
}

function hasReducedHours(avail: SeasonalAvailability, month: number): boolean {
  return avail.reducedHoursMonths.includes(month);
}

function availableDatesInMonth(
  avail: SeasonalAvailability,
  year: number,
  month: number
): string[] {
  if (!isAvailableInMonth(avail, month)) return [];
  const dates: string[] = [];
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (!isBlackedOut(avail, date)) dates.push(date);
  }
  return dates;
}

const AVAIL: SeasonalAvailability = {
  venueId: "v1",
  availableMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  blackoutDates: ["2026-10-15", "2026-10-16"],
  reducedHoursMonths: [12, 1],
};

describe("Venue seasonal availability", () => {
  it("isAvailableInMonth: October (10) → true", () => {
    expect(isAvailableInMonth(AVAIL, 10)).toBe(true);
  });

  it("isAvailableInMonth: December (12) → false", () => {
    expect(isAvailableInMonth(AVAIL, 12)).toBe(false);
  });

  it("isBlackedOut: Oct 15 → true", () => {
    expect(isBlackedOut(AVAIL, "2026-10-15")).toBe(true);
  });

  it("isBlackedOut: Oct 14 → false", () => {
    expect(isBlackedOut(AVAIL, "2026-10-14")).toBe(false);
  });

  it("hasReducedHours: January → true", () => {
    expect(hasReducedHours(AVAIL, 1)).toBe(true);
  });

  it("hasReducedHours: June → false", () => {
    expect(hasReducedHours(AVAIL, 6)).toBe(false);
  });

  it("availableDatesInMonth: Oct 2026 excludes 2 blackout days", () => {
    const dates = availableDatesInMonth(AVAIL, 2026, 10);
    expect(dates).toHaveLength(29); // 31 days - 2 blackout
    expect(dates).not.toContain("2026-10-15");
  });

  it("availableDatesInMonth: Dec 2026 → empty (not available)", () => {
    expect(availableDatesInMonth(AVAIL, 2026, 12)).toHaveLength(0);
  });
});
