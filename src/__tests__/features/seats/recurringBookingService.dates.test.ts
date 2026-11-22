import { expandRecurringDates } from "@/features/seats/recurringBookingService";
import { parseBookingDateTime, formatToWallClock, timeZoneOffsetMs } from "@/lib/booking/dateTimeAdapter";
import * as recurrenceModule from "@/lib/booking/recurrence";

describe("recurringBookingService Monthly Recurrence & Date Boundaries (#9446)", () => {
  describe("Engine Reuse Verification", () => {
    it("reuses generateRecurringDates from @/lib/booking/recurrence for monthly frequency", () => {
      const spy = jest.spyOn(recurrenceModule, "generateRecurringDates");
      expandRecurringDates("FREQ=MONTHLY;INTERVAL=1", {
        startDate: "2028-01-31",
        endDate: "2028-04-30",
      });

      expect(spy).toHaveBeenCalledWith(
        "2028-01-31",
        "monthly",
        "2028-04-30",
        expect.any(Number),
      );
      spy.mockRestore();
    });
  });

  describe("Leap-Year Month-End Boundaries (2028)", () => {
    it("clamps January 31, 2028 to February 29, 2028 in leap year", () => {
      const dates = expandRecurringDates("FREQ=MONTHLY;INTERVAL=1", {
        startDate: "2028-01-31",
        endDate: "2028-04-30",
      });

      expect(dates).toEqual([
        "2028-01-31",
        "2028-02-29",
        "2028-03-31",
        "2028-04-30",
      ]);
    });

    it("clamps January 30, 2028 to February 29, 2028 and returns to March 30", () => {
      const dates = expandRecurringDates("FREQ=MONTHLY;INTERVAL=1", {
        startDate: "2028-01-30",
        endDate: "2028-04-30",
      });

      expect(dates).toEqual([
        "2028-01-30",
        "2028-02-29",
        "2028-03-30",
        "2028-04-30",
      ]);
    });

    it("expands January 29, 2028 to February 29, 2028 in leap year", () => {
      const dates = expandRecurringDates("FREQ=MONTHLY;INTERVAL=1", {
        startDate: "2028-01-29",
        endDate: "2028-03-31",
      });

      expect(dates).toEqual([
        "2028-01-29",
        "2028-02-29",
        "2028-03-29",
      ]);
    });

    it("expands February 29, 2028 (leap day start) to March 29, 2028", () => {
      const dates = expandRecurringDates("FREQ=MONTHLY;INTERVAL=1", {
        startDate: "2028-02-29",
        endDate: "2028-05-31",
      });

      expect(dates).toEqual([
        "2028-02-29",
        "2028-03-29",
        "2028-04-29",
        "2028-05-29",
      ]);
    });
  });

  describe("Non-Leap-Year Month-End Boundaries (2027)", () => {
    it("clamps January 31, 2027 to February 28, 2027 in non-leap year", () => {
      const dates = expandRecurringDates("FREQ=MONTHLY;INTERVAL=1", {
        startDate: "2027-01-31",
        endDate: "2027-04-30",
      });

      expect(dates).toEqual([
        "2027-01-31",
        "2027-02-28",
        "2027-03-31",
        "2027-04-30",
      ]);
    });

    it("clamps January 30, 2027 to February 28, 2027 in non-leap year", () => {
      const dates = expandRecurringDates("FREQ=MONTHLY;INTERVAL=1", {
        startDate: "2027-01-30",
        endDate: "2027-04-30",
      });

      expect(dates).toEqual([
        "2027-01-30",
        "2027-02-28",
        "2027-03-30",
        "2027-04-30",
      ]);
    });

    it("clamps January 29, 2027 to February 28, 2027 in non-leap year", () => {
      const dates = expandRecurringDates("FREQ=MONTHLY;INTERVAL=1", {
        startDate: "2027-01-29",
        endDate: "2027-03-31",
      });

      expect(dates).toEqual([
        "2027-01-29",
        "2027-02-28",
        "2027-03-29",
      ]);
    });
  });

  describe("Month-End Transitions (31-day to 30-day months)", () => {
    it("clamps March 31 to April 30 and restores May 31", () => {
      const dates = expandRecurringDates("FREQ=MONTHLY;INTERVAL=1", {
        startDate: "2028-03-31",
        endDate: "2028-06-30",
      });

      expect(dates).toEqual([
        "2028-03-31",
        "2028-04-30",
        "2028-05-31",
        "2028-06-30",
      ]);
    });

    it("clamps May 31 to June 30 and restores July 31", () => {
      const dates = expandRecurringDates("FREQ=MONTHLY;INTERVAL=1", {
        startDate: "2028-05-31",
        endDate: "2028-08-31",
      });

      expect(dates).toEqual([
        "2028-05-31",
        "2028-06-30",
        "2028-07-31",
        "2028-08-31",
      ]);
    });

    it("clamps August 31 to September 30 and October 31 to November 30", () => {
      const dates = expandRecurringDates("FREQ=MONTHLY;INTERVAL=1", {
        startDate: "2028-08-31",
        endDate: "2028-12-31",
      });

      expect(dates).toEqual([
        "2028-08-31",
        "2028-09-30",
        "2028-10-31",
        "2028-11-30",
        "2028-12-31",
      ]);
    });
  });

  describe("Recurrence Anchor Preservation", () => {
    it("ensures clamping one occurrence does not permanently modify subsequent occurrences", () => {
      // 12-month series starting on Jan 31
      const dates = expandRecurringDates("FREQ=MONTHLY;INTERVAL=1", {
        startDate: "2027-01-31",
        endDate: "2027-12-31",
      });

      expect(dates).toEqual([
        "2027-01-31",
        "2027-02-28", // Clamped
        "2027-03-31", // Anchored to 31st
        "2027-04-30", // Clamped
        "2027-05-31", // Anchored to 31st
        "2027-06-30", // Clamped
        "2027-07-31", // Anchored to 31st
        "2027-08-31", // Anchored to 31st
        "2027-09-30", // Clamped
        "2027-10-31", // Anchored to 31st
        "2027-11-30", // Clamped
        "2027-12-31", // Anchored to 31st
      ]);
    });

    it("preserves day 30 anchor across February clamping", () => {
      const dates = expandRecurringDates("FREQ=MONTHLY;INTERVAL=1", {
        startDate: "2028-01-30",
        endDate: "2028-04-30",
      });

      expect(dates).toEqual([
        "2028-01-30",
        "2028-02-29",
        "2028-03-30",
        "2028-04-30",
      ]);
    });
  });

  describe("Monthly Intervals & Boundary Termination", () => {
    it("supports INTERVAL=2 for bi-monthly recurrence", () => {
      const dates = expandRecurringDates("FREQ=MONTHLY;INTERVAL=2", {
        startDate: "2028-01-31",
        endDate: "2028-07-31",
      });

      // Month 0 (Jan 31), Month 2 (Mar 31), Month 4 (May 31), Month 6 (Jul 31)
      expect(dates).toEqual([
        "2028-01-31",
        "2028-03-31",
        "2028-05-31",
        "2028-07-31",
      ]);
    });

    it("terminates recurrence strictly at range endDate boundary", () => {
      const dates = expandRecurringDates("FREQ=MONTHLY;INTERVAL=1", {
        startDate: "2028-01-31",
        endDate: "2028-02-28", // Target Feb 29 is after endDate
      });

      expect(dates).toEqual(["2028-01-31"]);
    });

    it("returns empty array when endDate is before startDate", () => {
      const dates = expandRecurringDates("FREQ=MONTHLY;INTERVAL=1", {
        startDate: "2028-05-01",
        endDate: "2028-04-30",
      });

      expect(dates).toEqual([]);
    });
  });

  describe("Timezone Offset & Local Calendar Date Consistency", () => {
    it("preserves local calendar date across positive UTC offset (Tokyo UTC+9)", () => {
      const dates = expandRecurringDates("FREQ=MONTHLY;INTERVAL=1", {
        startDate: "2028-01-31",
        endDate: "2028-03-31",
      });

      const timeZone = "Asia/Tokyo";
      const timeStr = "09:00";

      for (const d of dates) {
        const instant = parseBookingDateTime(d, timeStr, timeZone);
        expect(instant).not.toBeNull();
        const wallClock = formatToWallClock(instant!, timeZone);
        expect(wallClock.date).toBe(d);
        expect(wallClock.time).toBe(timeStr);
      }
    });

    it("preserves local calendar date across negative UTC offset (New York UTC-5)", () => {
      const dates = expandRecurringDates("FREQ=MONTHLY;INTERVAL=1", {
        startDate: "2028-01-31",
        endDate: "2028-03-31",
      });

      const timeZone = "America/New_York";
      const timeStr = "18:00";

      for (const d of dates) {
        const instant = parseBookingDateTime(d, timeStr, timeZone);
        expect(instant).not.toBeNull();
        const wallClock = formatToWallClock(instant!, timeZone);
        expect(wallClock.date).toBe(d);
        expect(wallClock.time).toBe(timeStr);
      }
    });
  });

  describe("Daylight Saving Time (DST) Transitions", () => {
    it("preserves wall-clock time across Spring-Forward transition in America/New_York", () => {
      // US DST spring-forward happens second Sunday in March (March 12, 2028)
      // Recurrence on 15th of Jan, Feb, Mar, Apr
      const dates = expandRecurringDates("FREQ=MONTHLY;INTERVAL=1", {
        startDate: "2028-01-15",
        endDate: "2028-04-15",
      });

      const timeZone = "America/New_York";
      const bookingTime = "14:30";

      for (const d of dates) {
        const instant = parseBookingDateTime(d, bookingTime, timeZone);
        expect(instant).not.toBeNull();
        const wallClock = formatToWallClock(instant!, timeZone);
        expect(wallClock.date).toBe(d);
        expect(wallClock.time).toBe(bookingTime);
      }
    });

    it("preserves wall-clock time across Fall-Back transition in America/New_York", () => {
      // US DST fall-back happens first Sunday in November (Nov 5, 2028)
      const dates = expandRecurringDates("FREQ=MONTHLY;INTERVAL=1", {
        startDate: "2028-09-15",
        endDate: "2028-12-15",
      });

      const timeZone = "America/New_York";
      const bookingTime = "09:00";

      for (const d of dates) {
        const instant = parseBookingDateTime(d, bookingTime, timeZone);
        expect(instant).not.toBeNull();
        const wallClock = formatToWallClock(instant!, timeZone);
        expect(wallClock.date).toBe(d);
        expect(wallClock.time).toBe(bookingTime);
      }
    });
  });

  describe("Backward Compatibility: Existing Weekly Recurrence", () => {
    it("preserves existing weekly Monday-Thursday recurrence behavior", () => {
      const dates = expandRecurringDates("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH", {
        startDate: "2026-11-02",
        endDate: "2026-11-22",
      });

      expect(dates).toHaveLength(12);
      expect(dates[0]).toBe("2026-11-02");
      expect(dates[dates.length - 1]).toBe("2026-11-19");
    });

    it("handles WEEKDAYS shorthand in weekly recurrence", () => {
      const dates = expandRecurringDates("FREQ=WEEKLY;WEEKDAYS;INTERVAL=1", {
        startDate: "2026-11-02",
        endDate: "2026-11-08",
      });

      expect(dates).toEqual([
        "2026-11-02",
        "2026-11-03",
        "2026-11-04",
        "2026-11-05",
        "2026-11-06",
      ]);
    });
  });
});
