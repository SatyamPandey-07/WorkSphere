import {
  formatToWallClock,
  isValidBookingDate,
  isValidTimeZone,
  normalizeBookingTime,
  parseBookingDateTime,
} from "./dateTimeAdapter";
import { todayInTimeZone } from "../bookingTime";
import {
  generateRecurringDates,
  MAX_RECURRING_OCCURRENCES,
  type RecurrenceFrequency,
} from "./recurrence";

export const MAX_RECURRING_BOOKING_WINDOW_DAYS = 90;

export interface ValidatedRecurringReservation {
  date: string;
  time: string;
  timeZone: string;
  duration: number;
  frequency: RecurrenceFrequency;
  endDate: string | null;
  occurrences: number | null;
  dates: string[];
}

export type RecurringReservationValidation =
  | { success: true; data: ValidatedRecurringReservation }
  | { success: false; fieldErrors: Record<string, string> };

function isRecurrenceFrequency(value: unknown): value is RecurrenceFrequency {
  return value === "daily" || value === "weekly" || value === "monthly";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

export function validateRecurringReservation(
  input: unknown,
  now: Date = new Date(),
): RecurringReservationValidation {
  const body = isRecord(input) ? input : {};
  const fieldErrors: Record<string, string> = {};

  const date = typeof body.date === "string" ? body.date : "";
  if (!isValidBookingDate(date)) {
    fieldErrors.date = "date must be a valid ISO 8601 calendar date.";
  }

  const normalizedTime = normalizeBookingTime(
    typeof body.time === "string" ? body.time : "",
  );
  if (!normalizedTime) {
    fieldErrors.time = "time must be a valid booking time.";
  }

  let timeZone = "UTC";
  if (body.timeZone !== undefined && body.timeZone !== null && body.timeZone !== "") {
    if (isValidTimeZone(body.timeZone)) {
      timeZone = body.timeZone;
    } else {
      fieldErrors.timeZone = "timeZone must be a valid IANA time zone.";
    }
  }

  const duration = Number(body.duration);
  if (!Number.isInteger(duration) || duration < 30 || duration > 480) {
    fieldErrors.duration = "duration must be an integer between 30 and 480 minutes.";
  }

  const requestedFrequency =
    body.frequency === undefined ? "weekly" : body.frequency;
  const validFrequency = isRecurrenceFrequency(requestedFrequency);
  if (!validFrequency) {
    fieldErrors.frequency = "frequency must be daily, weekly, or monthly.";
  }
  const frequency: RecurrenceFrequency = validFrequency
    ? requestedFrequency
    : "weekly";

  let endDate: string | null = null;
  if (body.endDate !== undefined && body.endDate !== null && body.endDate !== "") {
    if (typeof body.endDate === "string" && isValidBookingDate(body.endDate)) {
      endDate = body.endDate;
    } else {
      fieldErrors.endDate = "endDate must be a valid ISO 8601 calendar date.";
    }
  }

  let occurrences: number | null = null;
  if (
    body.occurrences !== undefined &&
    body.occurrences !== null &&
    body.occurrences !== ""
  ) {
    if (
      typeof body.occurrences === "number" &&
      Number.isFinite(body.occurrences) &&
      Number.isInteger(body.occurrences) &&
      body.occurrences > 0
    ) {
      occurrences = Math.min(
        body.occurrences,
        MAX_RECURRING_OCCURRENCES,
      );
    } else {
      fieldErrors.occurrences = "occurrences must be a positive integer.";
    }
  }

  if (
    !endDate &&
    !occurrences &&
    !fieldErrors.endDate &&
    !fieldErrors.occurrences
  ) {
    fieldErrors.endDate =
      "Provide either a valid endDate or a number of occurrences.";
  }

  const today = todayInTimeZone(timeZone, now);
  const lastBookableDate = addCalendarDays(
    today,
    MAX_RECURRING_BOOKING_WINDOW_DAYS,
  );

  if (isValidBookingDate(date) && date < today) {
    fieldErrors.date = "date must not be in the past.";
  } else if (isValidBookingDate(date) && date > lastBookableDate) {
    fieldErrors.date = `date cannot be more than ${MAX_RECURRING_BOOKING_WINDOW_DAYS} days in advance.`;
  }

  if (endDate && isValidBookingDate(date)) {
    if (endDate < date) {
      fieldErrors.endDate = "endDate must be on or after date.";
    } else if (endDate > lastBookableDate) {
      fieldErrors.endDate = `endDate cannot be more than ${MAX_RECURRING_BOOKING_WINDOW_DAYS} days in advance.`;
    }
  }

  let firstStart: Date | null = null;
  if (isValidBookingDate(date) && normalizedTime && !fieldErrors.timeZone) {
    firstStart = parseBookingDateTime(date, normalizedTime, timeZone);
    const wallClock = firstStart
      ? formatToWallClock(firstStart, timeZone)
      : null;
    if (
      !firstStart ||
      wallClock?.date !== date ||
      wallClock?.time !== normalizedTime
    ) {
      fieldErrors.time =
        "time does not exist on this date in the selected time zone.";
    } else if (firstStart.getTime() < now.getTime()) {
      fieldErrors.time = "time must not be in the past.";
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { success: false, fieldErrors };
  }

  const dates = generateRecurringDates(
    date,
    frequency,
    endDate,
    occurrences,
  );
  if (dates.length === 0) {
    return {
      success: false,
      fieldErrors: {
        endDate: "No valid dates were generated for the recurrence pattern.",
      },
    };
  }

  if (dates.some((bookingDate) => bookingDate > lastBookableDate)) {
    return {
      success: false,
      fieldErrors: {
        occurrences: `Recurring bookings cannot extend beyond ${MAX_RECURRING_BOOKING_WINDOW_DAYS} days in advance.`,
      },
    };
  }

  for (const bookingDate of dates) {
    const time = normalizedTime ?? "";
    const start = parseBookingDateTime(bookingDate, time, timeZone);
    const wallClock = start ? formatToWallClock(start, timeZone) : null;
    if (
      !start ||
      wallClock?.date !== bookingDate ||
      wallClock?.time !== time
    ) {
      return {
        success: false,
        fieldErrors: {
          time: `time does not exist on every recurrence date in ${timeZone}.`,
        },
      };
    }
  }

  return {
    success: true,
    data: {
      date,
      time: normalizedTime ?? "",
      timeZone,
      duration,
      frequency,
      endDate,
      occurrences,
      dates,
    },
  };
}
