import { NextResponse } from "next/server";
import { z } from "zod";

export const DEFAULT_MAX_RANGE_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface DateFilterOptions {
  maxRangeDays?: number;
}

export interface DateRangeValidationError {
  success: false;
  code: "INVALID_DATE_RANGE";
  message: string;
  issues: Array<{
    path: string;
    message: string;
  }>;
}

export interface DateRangeValidationSuccess {
  success: true;
  data: {
    startDate?: Date;
    endDate?: Date;
  };
}

export type DateRangeValidationResult =
  DateRangeValidationSuccess | DateRangeValidationError;

const timestampFieldSchema = z.preprocess(
  (val) => {
    if (val === undefined || val === null || val === "") return undefined;
    if (val instanceof Date) return val;
    if (typeof val === "string" || typeof val === "number") {
      const parsed = new Date(val);
      return parsed;
    }
    return val;
  },
  z
    .date({
      // zod 4 takes `error` (it ignores the zod 3 `invalid_type_error`). It
      // rejects an Invalid Date itself, before any refine, so both messages
      // are given here.
      error: (issue) =>
        issue.input instanceof Date
          ? "Invalid timestamp value"
          : "Invalid timestamp format",
    })
    .optional(),
);

export function createDateFilterSchema(options: DateFilterOptions = {}) {
  const { maxRangeDays } = options;

  return z
    .object({
      startDate: timestampFieldSchema,
      endDate: timestampFieldSchema,
    })
    .refine(
      (data) => {
        if (!data.startDate || !data.endDate) return true;
        return data.startDate.getTime() <= data.endDate.getTime();
      },
      {
        message: "startDate must be chronologically before or equal to endDate",
        path: ["endDate"],
        params: { code: "INVALID_DATE_RANGE" },
      },
    )
    .refine(
      (data) => {
        if (!maxRangeDays || !data.startDate || !data.endDate) return true;
        const diffMs = data.endDate.getTime() - data.startDate.getTime();
        return diffMs <= maxRangeDays * MS_PER_DAY;
      },
      {
        message: `Date range cannot exceed ${maxRangeDays ?? DEFAULT_MAX_RANGE_DAYS} days`,
        path: ["endDate"],
        params: { code: "INVALID_DATE_RANGE" },
      },
    );
}

export const dateFilterSchema = createDateFilterSchema();

export function parseDateFilter(
  input: {
    startDate?: unknown;
    endDate?: unknown;
  },
  options: DateFilterOptions = {},
): DateRangeValidationResult {
  const schema = options.maxRangeDays
    ? createDateFilterSchema(options)
    : dateFilterSchema;

  const result = schema.safeParse(input);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.join(".") || "dateRange",
      message: issue.message,
    }));

    return {
      success: false,
      code: "INVALID_DATE_RANGE",
      message: issues[0]?.message ?? "Invalid date range parameters",
      issues,
    };
  }

  return {
    success: true,
    data: result.data,
  };
}

/**
 * Strict ISO 8601 regex:
 * Accepts:
 *  - YYYY-MM-DD
 *  - YYYY-MM-DDTHH:mm:ssZ
 *  - YYYY-MM-DDTHH:mm:ss.sssZ
 *  - YYYY-MM-DDTHH:mm:ss±HH:mm
 *  - YYYY-MM-DDTHH:mm:ss.sss±HH:mm
 *  - YYYY-MM-DDTHH:mm:ss
 *  - YYYY-MM-DDTHH:mm:ss.sss
 */
export const ISO_8601_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)?)?$/i;

/**
 * Validates whether a calendar year, month, and day combination is valid,
 * including leap-year calculation for February.
 */
function isValidCalendarDate(
  year: number,
  month: number,
  day: number,
): boolean {
  if (year < 1000 || year > 9999) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;

  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

  const daysInMonth = [
    31,
    isLeapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  return day <= daysInMonth[month - 1];
}

/**
 * Checks whether a given string is a strictly valid ISO 8601 timestamp or date.
 * Rejects non-ISO formats, malformed dates (e.g. 2026-02-30, 2026-13-01),
 * invalid hours/minutes/seconds, and out-of-range timezone offsets.
 */
export function isValidIso8601(val: unknown): boolean {
  if (typeof val !== "string" || !val.trim()) return false;
  const trimmed = val.trim();

  const match = ISO_8601_REGEX.exec(trimmed);
  if (!match) return false;

  const [, yearStr, monthStr, dayStr, hourStr, minStr, secStr, , offsetStr] =
    match;

  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  if (!isValidCalendarDate(year, month, day)) {
    return false;
  }

  // If time components are present, validate hours, minutes, and seconds
  if (hourStr !== undefined) {
    const hour = parseInt(hourStr, 10);
    const minute = parseInt(minStr, 10);
    const second = parseInt(secStr, 10);

    if (hour < 0 || hour > 23) return false;
    if (minute < 0 || minute > 59) return false;
    if (second < 0 || second > 59) return false;
  }

  // If timezone offset is present (e.g. +05:30 or -08:00)
  if (offsetStr && offsetStr.toUpperCase() !== "Z") {
    const cleanOffset = offsetStr.replace(":", "");
    const offsetHours = Math.abs(parseInt(cleanOffset.slice(0, 3), 10));
    const offsetMinutes = parseInt(cleanOffset.slice(3, 5), 10);

    if (offsetHours > 23 || offsetMinutes > 59) return false;
  }

  // Ensure JavaScript Date parser can parse it without returning NaN
  const parsed = Date.parse(
    hourStr === undefined ? `${trimmed}T00:00:00Z` : trimmed,
  );
  return !Number.isNaN(parsed);
}

/**
 * Normalizes an ISO 8601 date or timestamp to a canonical UTC ISO string:
 * Format: YYYY-MM-DDTHH:mm:ss.sssZ
 */
export function normalizeToUtcIso(val: string): string {
  if (!isValidIso8601(val)) {
    throw new Error(`Invalid ISO 8601 date string: ${val}`);
  }

  const trimmed = val.trim();

  // Date-only format (YYYY-MM-DD) -> anchor to midnight UTC
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split("-").map((v) => parseInt(v, 10));
    const utcDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    return utcDate.toISOString();
  }

  // If no timezone offset or Z was specified, treat as UTC
  let dateToParse = trimmed;
  if (!trimmed.endsWith("Z") && !/[+-]\d{2}(?::?\d{2})?$/.test(trimmed)) {
    dateToParse = `${trimmed}Z`;
  }

  const date = new Date(dateToParse);
  return date.toISOString();
}

/**
 * Zod schema for validating and normalizing ISO 8601 timestamps.
 */
export const iso8601TimestampSchema = z
  .string()
  .refine(isValidIso8601, {
    message:
      "Must be a valid ISO 8601 date string (e.g. YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss.sssZ)",
  })
  .transform((val) => normalizeToUtcIso(val));

export const bookingDateFilterSchema = z
  .object({
    startDate: z
      .string()
      .refine(isValidIso8601, {
        message: "startDate must be a valid ISO 8601 date string",
      })
      .optional(),
    endDate: z
      .string()
      .refine(isValidIso8601, {
        message: "endDate must be a valid ISO 8601 date string",
      })
      .optional(),
    date: z
      .string()
      .refine(isValidIso8601, {
        message: "date must be a valid ISO 8601 date string",
      })
      .optional(),
  })
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        const start = new Date(normalizeToUtcIso(data.startDate)).getTime();
        const end = new Date(normalizeToUtcIso(data.endDate)).getTime();
        return start <= end;
      }
      return true;
    },
    {
      message: "startDate must be before or equal to endDate",
      path: ["startDate"],
    },
  );

export interface FieldError {
  field: string;
  issue: string;
}

/**
 * Constructs a structured 400 Bad Request response with field-specific errors.
 */
export function createDateFilterErrorResponse(
  errors: Array<{ field: string; issue?: string; message?: string }>,
  detail = "Invalid date filter parameters",
): NextResponse {
  const normalizedErrors: FieldError[] = errors.map((err) => ({
    field: err.field,
    issue: err.issue || err.message || "Invalid date format",
  }));

  const primaryMessage = normalizedErrors[0]?.issue || detail;

  return NextResponse.json(
    {
      type: "https://api.worksphere.com/errors/bad-request",
      title: "Bad Request",
      status: 400,
      code: "BAD_REQUEST",
      error: primaryMessage,
      detail: primaryMessage,
      errors: normalizedErrors,
      fieldErrors: normalizedErrors.map((e) => ({
        field: e.field,
        message: e.issue,
      })),
    },
    {
      status: 400,
      headers: {
        "Content-Type": "application/problem+json",
      },
    },
  );
}

export interface ParsedBookingDateFilter {
  startDate?: string;
  endDate?: string;
  date?: string;
  startDateUtc?: string;
  endDateUtc?: string;
  dateUtc?: string;
}

export type ParseBookingDateFilterResult =
  | { success: true; data: ParsedBookingDateFilter }
  | {
      success: false;
      response: NextResponse;
      errors: FieldError[];
    };

/**
 * Parses, validates, and normalizes date filter query parameters from a URL,
 * Request, URLSearchParams, or plain object.
 */
export function parseBookingDateFilter(
  input: URLSearchParams | Request | Record<string, string | null | undefined>,
): ParseBookingDateFilterResult {
  let params: {
    startDate?: string | null;
    endDate?: string | null;
    date?: string | null;
  } = {};

  if (typeof (input as Request).url === "string") {
    const url = new URL((input as Request).url);
    params = {
      startDate:
        url.searchParams.get("startDate") || url.searchParams.get("from"),
      endDate: url.searchParams.get("endDate") || url.searchParams.get("to"),
      date: url.searchParams.get("date"),
    };
  } else if (input instanceof URLSearchParams) {
    params = {
      startDate: input.get("startDate") || input.get("from"),
      endDate: input.get("endDate") || input.get("to"),
      date: input.get("date"),
    };
  } else if (input && typeof input === "object") {
    const record = input as Record<string, string | null | undefined>;
    params = {
      startDate: record.startDate || record.from,
      endDate: record.endDate || record.to,
      date: record.date,
    };
  }

  const errors: FieldError[] = [];

  let normalizedStartDate: string | undefined;
  if (params.startDate) {
    if (!isValidIso8601(params.startDate)) {
      errors.push({
        field: "startDate",
        issue:
          "startDate must be a valid ISO 8601 date string (e.g. YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss.sssZ)",
      });
    } else {
      normalizedStartDate = normalizeToUtcIso(params.startDate);
    }
  }

  let normalizedEndDate: string | undefined;
  if (params.endDate) {
    if (!isValidIso8601(params.endDate)) {
      errors.push({
        field: "endDate",
        issue:
          "endDate must be a valid ISO 8601 date string (e.g. YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss.sssZ)",
      });
    } else {
      normalizedEndDate = normalizeToUtcIso(params.endDate);
    }
  }

  let normalizedDate: string | undefined;
  if (params.date) {
    if (!isValidIso8601(params.date)) {
      errors.push({
        field: "date",
        issue:
          "date must be a valid ISO 8601 date string (e.g. YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss.sssZ)",
      });
    } else {
      normalizedDate = normalizeToUtcIso(params.date);
    }
  }

  // Check chronological range if both start and end dates are valid
  if (normalizedStartDate && normalizedEndDate) {
    const startMs = new Date(normalizedStartDate).getTime();
    const endMs = new Date(normalizedEndDate).getTime();
    if (startMs > endMs) {
      errors.push({
        field: "startDate",
        issue: "startDate must be before or equal to endDate",
      });
    }
  }

  if (errors.length > 0) {
    return {
      success: false,
      response: createDateFilterErrorResponse(errors),
      errors,
    };
  }

  return {
    success: true,
    data: {
      startDate: normalizedStartDate,
      endDate: normalizedEndDate,
      date: normalizedDate,
      startDateUtc: normalizedStartDate,
      endDateUtc: normalizedEndDate,
      dateUtc: normalizedDate,
    },
  };
}

// ─── Booking Date Presets (#9608) ─────────────────────────────────────────

export type DatePresetKey = "today" | "tomorrow" | "weekend" | "nextMonday";

export interface DatePresetResult {
  startDate: string;
  endDate: string;
}

/**
 * Formats a Date instance as local `YYYY-MM-DD` using local calendar components.
 * Avoids UTC shifts and millisecond duration calculations.
 */
export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Calculates calendar date presets ("today", "tomorrow", "weekend") using local calendar logic.
 *
 * Rules:
 * - "today": start date = current local calendar date, end date = same date.
 * - "tomorrow": start date = next local calendar date, end date = same date.
 * - "weekend": start date = upcoming Saturday, end date = upcoming Sunday.
 *   If today is Saturday or Sunday, uses the current weekend (Sat & Sun).
 *   Otherwise, calculates the upcoming Saturday and Sunday.
 *
 * All boundary transitions (month, year, leap years) are safely handled via `Date(year, month, day)`.
 */
export function getDatePreset(
  preset: DatePresetKey,
  referenceDate: Date = new Date(),
): DatePresetResult {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const date = referenceDate.getDate();

  switch (preset) {
    case "today": {
      const today = new Date(year, month, date);
      const formatted = formatLocalDate(today);
      return { startDate: formatted, endDate: formatted };
    }

    case "tomorrow": {
      const tomorrow = new Date(year, month, date + 1);
      const formatted = formatLocalDate(tomorrow);
      return { startDate: formatted, endDate: formatted };
    }

    case "weekend": {
      // Day of week: 0 = Sunday, 1 = Monday, ..., 5 = Friday, 6 = Saturday
      const dayOfWeek = referenceDate.getDay();
      let saturdayOffset: number;

      if (dayOfWeek === 6) {
        // Today is Saturday
        saturdayOffset = 0;
      } else if (dayOfWeek === 0) {
        // Today is Sunday -> current weekend started yesterday (-1)
        saturdayOffset = -1;
      } else {
        // Weekday (Mon=1..Fri=5) -> upcoming Saturday is (6 - dayOfWeek)
        saturdayOffset = 6 - dayOfWeek;
      }

      const saturday = new Date(year, month, date + saturdayOffset);
      const sunday = new Date(year, month, date + saturdayOffset + 1);

      return {
        startDate: formatLocalDate(saturday),
        endDate: formatLocalDate(sunday),
      };
    }

    case "nextMonday": {
      // Days until next Monday: Sun (0) -> 1, Mon (1) -> 7, Tue (2) -> 6, ..., Sat (6) -> 2
      const dayOfWeek = referenceDate.getDay();
      const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
      const nextMonday = new Date(year, month, date + daysUntilMonday);
      const formatted = formatLocalDate(nextMonday);
      return { startDate: formatted, endDate: formatted };
    }
  }
}
