/**
 * Tests for recurring booking date generation.
 */

type RecurringFrequency = "weekly" | "biweekly" | "monthly";

function generateRecurringDates(
  startDate: string,
  frequency: RecurringFrequency,
  count: number,
): string[] {
  const dates: string[] = [];
  const current = new Date(startDate + "T00:00:00Z");

  for (let i = 0; i < count; i++) {
    dates.push(current.toISOString().slice(0, 10));
    if (frequency === "weekly")   current.setUTCDate(current.getUTCDate() + 7);
    if (frequency === "biweekly") current.setUTCDate(current.getUTCDate() + 14);
    if (frequency === "monthly")  current.setUTCMonth(current.getUTCMonth() + 1);
  }

  return dates;
}

describe("Recurring booking date generation", () => {
  it("weekly: generates 4 dates 7 days apart", () => {
    const dates = generateRecurringDates("2026-09-01", "weekly", 4);
    expect(dates).toHaveLength(4);
    expect(dates[0]).toBe("2026-09-01");
    expect(dates[1]).toBe("2026-09-08");
    expect(dates[3]).toBe("2026-09-22");
  });

  it("biweekly: generates dates 14 days apart", () => {
    const dates = generateRecurringDates("2026-09-01", "biweekly", 3);
    expect(dates[1]).toBe("2026-09-15");
  });

  it("monthly: generates dates 1 month apart", () => {
    const dates = generateRecurringDates("2026-09-15", "monthly", 3);
    expect(dates[1]).toBe("2026-10-15");
    expect(dates[2]).toBe("2026-11-15");
  });

  it("count=1 returns only start date", () => {
    const dates = generateRecurringDates("2026-09-01", "weekly", 1);
    expect(dates).toHaveLength(1);
    expect(dates[0]).toBe("2026-09-01");
  });

  it("count=0 returns empty array", () => {
    expect(generateRecurringDates("2026-09-01", "weekly", 0)).toHaveLength(0);
  });

  it("all dates match ISO 8601 date format", () => {
    const dates = generateRecurringDates("2026-09-01", "weekly", 5);
    dates.forEach((d) => {
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
