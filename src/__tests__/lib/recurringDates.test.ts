/**
 * Regression tests for the shared recurring-booking date generator used by both
 * POST /api/reservations/recurring-book and the reservation form preview.
 */

import {
  generateRecurringDates,
  MAX_RECURRING_OCCURRENCES,
} from "@/lib/booking/recurrence";

describe("generateRecurringDates", () => {
  describe("monthly series anchored on a day that does not exist in every month", () => {
    it("clamps to the last day of shorter months instead of spilling into the next month", () => {
      expect(generateRecurringDates("2027-01-31", "monthly", null, 6)).toEqual([
        "2027-01-31",
        "2027-02-28",
        "2027-03-31",
        "2027-04-30",
        "2027-05-31",
        "2027-06-30",
      ]);
    });

    it("books exactly one date in every month for a full year from the 31st", () => {
      const dates = generateRecurringDates("2027-01-31", "monthly", null, 12);
      const months = dates.map((d) => d.slice(0, 7));
      expect(new Set(months).size).toBe(12);
      expect(months).toEqual([
        "2027-01",
        "2027-02",
        "2027-03",
        "2027-04",
        "2027-05",
        "2027-06",
        "2027-07",
        "2027-08",
        "2027-09",
        "2027-10",
        "2027-11",
        "2027-12",
      ]);
    });

    it("does not permanently drift after a clamped month (Jan 31 -> Feb 28 -> Mar 31)", () => {
      const [, , march] = generateRecurringDates(
        "2027-01-31",
        "monthly",
        null,
        3,
      );
      expect(march).toBe("2027-03-31");
    });

    it("handles the 30th and the 29th", () => {
      expect(generateRecurringDates("2027-01-30", "monthly", null, 4)).toEqual([
        "2027-01-30",
        "2027-02-28",
        "2027-03-30",
        "2027-04-30",
      ]);
      expect(generateRecurringDates("2027-01-29", "monthly", null, 2)).toEqual([
        "2027-01-29",
        "2027-02-28",
      ]);
    });

    it("uses Feb 29 in a leap year", () => {
      expect(generateRecurringDates("2028-01-31", "monthly", null, 3)).toEqual([
        "2028-01-31",
        "2028-02-29",
        "2028-03-31",
      ]);
    });

    it("rolls over the year boundary", () => {
      expect(generateRecurringDates("2026-11-30", "monthly", null, 4)).toEqual([
        "2026-11-30",
        "2026-12-30",
        "2027-01-30",
        "2027-02-28",
      ]);
    });

    it("keeps the day unchanged for ordinary days", () => {
      expect(generateRecurringDates("2026-09-15", "monthly", null, 3)).toEqual([
        "2026-09-15",
        "2026-10-15",
        "2026-11-15",
      ]);
    });
  });

  describe("daily and weekly series", () => {
    it("steps by calendar days across a US DST change without repeating a date", () => {
      expect(generateRecurringDates("2027-03-12", "daily", null, 5)).toEqual([
        "2027-03-12",
        "2027-03-13",
        "2027-03-14",
        "2027-03-15",
        "2027-03-16",
      ]);
    });

    it("steps by exactly 7 calendar days across a DST change", () => {
      expect(generateRecurringDates("2027-03-01", "weekly", null, 4)).toEqual([
        "2027-03-01",
        "2027-03-08",
        "2027-03-15",
        "2027-03-22",
      ]);
    });
  });

  describe("limits", () => {
    it("stops at the end date (inclusive)", () => {
      expect(
        generateRecurringDates("2027-01-01", "weekly", "2027-01-15", null),
      ).toEqual(["2027-01-01", "2027-01-08", "2027-01-15"]);
    });

    it("stops at the end date for a clamped monthly series", () => {
      expect(
        generateRecurringDates("2027-01-31", "monthly", "2027-03-30", null),
      ).toEqual(["2027-01-31", "2027-02-28"]);
    });

    it("stops at whichever of end date / occurrences comes first", () => {
      expect(
        generateRecurringDates("2027-01-01", "daily", "2027-01-31", 3),
      ).toHaveLength(3);
    });

    it(`never exceeds ${MAX_RECURRING_OCCURRENCES} occurrences`, () => {
      expect(
        generateRecurringDates("2027-01-01", "daily", null, 500),
      ).toHaveLength(MAX_RECURRING_OCCURRENCES);
      expect(
        generateRecurringDates("2027-01-01", "daily", null, null),
      ).toHaveLength(MAX_RECURRING_OCCURRENCES);
    });
  });

  describe("invalid input", () => {
    it("returns [] for an invalid or empty start date instead of throwing", () => {
      expect(generateRecurringDates("", "weekly", null, 3)).toEqual([]);
      expect(generateRecurringDates("2027-02-30", "weekly", null, 3)).toEqual(
        [],
      );
      expect(generateRecurringDates("not-a-date", "monthly", null, 3)).toEqual(
        [],
      );
    });

    it("returns [] for an unknown frequency", () => {
      expect(generateRecurringDates("2027-01-01", "yearly", null, 3)).toEqual(
        [],
      );
    });
  });
});
