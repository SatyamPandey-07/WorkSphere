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
