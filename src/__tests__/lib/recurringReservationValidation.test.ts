import {
  formatToWallClock,
  parseBookingDateTime,
} from "@/lib/booking/dateTimeAdapter";
import {
  MAX_RECURRING_BOOKING_WINDOW_DAYS,
  validateRecurringReservation,
} from "@/lib/booking/recurringReservationValidation";

const futureNow = new Date("2027-03-01T12:00:00.000Z");

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    date: "2027-03-08",
    time: "09:00",
    timeZone: "America/New_York",
    duration: 60,
    frequency: "weekly",
    endDate: null,
    occurrences: 2,
    ...overrides,
  };
}

describe("validateRecurringReservation", () => {
  it("accepts valid leap-day bookings and returns normalized recurrence dates", () => {
    const result = validateRecurringReservation(
      validInput({
        date: "2028-02-29",
        timeZone: "UTC",
        frequency: "monthly",
        occurrences: 2,
      }),
      new Date("2028-02-01T00:00:00.000Z"),
    );

    expect(result).toMatchObject({
      success: true,
      data: { dates: ["2028-02-29", "2028-03-29"] },
    });
  });

  it("returns field errors for impossible or inverted ISO date ranges", () => {
    const impossibleDate = validateRecurringReservation(
      validInput({ date: "2027-02-29" }),
      futureNow,
    );
    const invertedRange = validateRecurringReservation(
      validInput({ date: "2027-03-15", endDate: "2027-03-14" }),
      futureNow,
    );
    const invalidEndDate = validateRecurringReservation(
      validInput({ endDate: "2027-02-30", occurrences: null }),
      futureNow,
    );

    expect(impossibleDate).toMatchObject({
      success: false,
      fieldErrors: { date: expect.stringContaining("ISO 8601") },
    });
    expect(invertedRange).toMatchObject({
      success: false,
      fieldErrors: { endDate: expect.stringContaining("on or after date") },
    });
    expect(invalidEndDate).toMatchObject({
      success: false,
      fieldErrors: { endDate: expect.stringContaining("ISO 8601") },
    });
  });

  it("rejects past starts and dates beyond the 90-day booking window", () => {
    const past = validateRecurringReservation(
      validInput({ date: "2027-02-28" }),
      futureNow,
    );
    const tooFarAhead = validateRecurringReservation(
      validInput({
        date: "2027-06-01",
        timeZone: "UTC",
        time: "13:00",
      }),
      new Date("2027-03-01T12:00:00.000Z"),
    );

    expect(past).toMatchObject({
      success: false,
      fieldErrors: { date: expect.stringContaining("past") },
    });
    expect(tooFarAhead).toMatchObject({
      success: false,
      fieldErrors: {
        date: expect.stringContaining(
          `${MAX_RECURRING_BOOKING_WINDOW_DAYS} days`,
        ),
      },
    });
  });

  it("rejects recurrence occurrences that exceed the booking window", () => {
    const result = validateRecurringReservation(
      validInput({
        date: "2027-03-01",
        timeZone: "UTC",
        time: "13:00",
        frequency: "weekly",
        occurrences: 14,
      }),
      new Date("2027-03-01T12:00:00.000Z"),
    );

    expect(result).toMatchObject({
      success: false,
      fieldErrors: {
        occurrences: expect.stringContaining(
          `${MAX_RECURRING_BOOKING_WINDOW_DAYS} days`,
        ),
      },
    });
  });

  it("rejects a recurrence that falls on a nonexistent local time during a DST change", () => {
    const result = validateRecurringReservation(
      validInput({
        date: "2027-03-07",
        time: "02:30",
        timeZone: "America/New_York",
        occurrences: 2,
      }),
      new Date("2027-03-01T12:00:00.000Z"),
    );

    expect(result).toMatchObject({
      success: false,
      fieldErrors: { time: expect.stringContaining("every recurrence date") },
    });
  });

  it("preserves wall-clock time and converts to UTC individually across the November DST fall-back boundary", () => {
    // 2027-11-07 is the US DST fall-back transition (clocks turn back from EDT UTC-4 to EST UTC-5).
    const now = new Date("2027-10-01T12:00:00.000Z");
    const result = validateRecurringReservation(
      validInput({
        date: "2027-10-25",
        time: "09:00",
        timeZone: "America/New_York",
        frequency: "weekly",
        occurrences: 4,
      }),
      now,
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.time).toBe("09:00");
    expect(result.data.dates).toEqual([
      "2027-10-25",
      "2027-11-01",
      "2027-11-08",
      "2027-11-15",
    ]);

    // Pre-fallback occurrences (EDT, UTC-4) -> 13:00 UTC
    const pre1 = parseBookingDateTime(
      result.data.dates[0],
      result.data.time,
      result.data.timeZone,
    );
    const pre2 = parseBookingDateTime(
      result.data.dates[1],
      result.data.time,
      result.data.timeZone,
    );
    expect(pre1?.toISOString()).toBe("2027-10-25T13:00:00.000Z");
    expect(pre2?.toISOString()).toBe("2027-11-01T13:00:00.000Z");

    // Post-fallback occurrences (EST, UTC-5) -> 14:00 UTC (not 13:00 UTC, which would shift local time to 08:00)
    const post1 = parseBookingDateTime(
      result.data.dates[2],
      result.data.time,
      result.data.timeZone,
    );
    const post2 = parseBookingDateTime(
      result.data.dates[3],
      result.data.time,
      result.data.timeZone,
    );
    expect(post1?.toISOString()).toBe("2027-11-08T14:00:00.000Z");
    expect(post2?.toISOString()).toBe("2027-11-15T14:00:00.000Z");

    // Wall-clock time remains strictly 09:00 for every occurrence
    for (const d of result.data.dates) {
      const instant = parseBookingDateTime(
        d,
        result.data.time,
        result.data.timeZone,
      );
      expect(instant).not.toBeNull();
      const wallClock = formatToWallClock(instant!, result.data.timeZone);
      expect(wallClock).toEqual({ date: d, time: "09:00" });
    }
  });

  it("preserves wall-clock time and converts to UTC individually across the March DST spring-forward boundary", () => {
    // 2027-03-14 is the US DST spring-forward transition (clocks turn forward from EST UTC-5 to EDT UTC-4).
    const now = new Date("2027-02-15T12:00:00.000Z");
    const result = validateRecurringReservation(
      validInput({
        date: "2027-03-01",
        time: "09:00",
        timeZone: "America/New_York",
        frequency: "weekly",
        occurrences: 4,
      }),
      now,
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.time).toBe("09:00");
    expect(result.data.dates).toEqual([
      "2027-03-01",
      "2027-03-08",
      "2027-03-15",
      "2027-03-22",
    ]);

    // Pre-transition occurrences (EST, UTC-5) -> 14:00 UTC
    const pre1 = parseBookingDateTime(
      result.data.dates[0],
      result.data.time,
      result.data.timeZone,
    );
    const pre2 = parseBookingDateTime(
      result.data.dates[1],
      result.data.time,
      result.data.timeZone,
    );
    expect(pre1?.toISOString()).toBe("2027-03-01T14:00:00.000Z");
    expect(pre2?.toISOString()).toBe("2027-03-08T14:00:00.000Z");

    // Post-transition occurrences (EDT, UTC-4) -> 13:00 UTC (not 14:00 UTC, which would shift local time to 10:00)
    const post1 = parseBookingDateTime(
      result.data.dates[2],
      result.data.time,
      result.data.timeZone,
    );
    const post2 = parseBookingDateTime(
      result.data.dates[3],
      result.data.time,
      result.data.timeZone,
    );
    expect(post1?.toISOString()).toBe("2027-03-15T13:00:00.000Z");
    expect(post2?.toISOString()).toBe("2027-03-22T13:00:00.000Z");

    // Wall-clock time remains strictly 09:00 for every occurrence
    for (const d of result.data.dates) {
      const instant = parseBookingDateTime(
        d,
        result.data.time,
        result.data.timeZone,
      );
      expect(instant).not.toBeNull();
      const wallClock = formatToWallClock(instant!, result.data.timeZone);
      expect(wallClock).toEqual({ date: d, time: "09:00" });
    }
  });

  it("requires a valid minimum duration and valid recurrence count", () => {
    const result = validateRecurringReservation(
      validInput({ duration: 29, occurrences: 1.5 }),
      futureNow,
    );

    expect(result).toMatchObject({
      success: false,
      fieldErrors: {
        duration: expect.stringContaining("30 and 480"),
        occurrences: expect.stringContaining("positive integer"),
      },
    });
  });
});
