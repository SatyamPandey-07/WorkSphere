export const DATE_STRING_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates a YYYY-MM-DD date string.
 * Checks regex pattern ^\d{4}-\d{2}-\d{2}$ and verifies calendar validity (!isNaN).
 * Returns Date on success, null on invalid input (or throws if throwOnError is true).
 */
export function validatePartitionDate(
  dateStr: string,
  throwOnError = false,
): Date | null {
  if (typeof dateStr !== "string" || !DATE_STRING_REGEX.test(dateStr)) {
    if (throwOnError) {
      throw new Error(
        `Invalid date format: "${dateStr}". Expected YYYY-MM-DD format.`,
      );
    }
    return null;
  }

  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    if (throwOnError) {
      throw new Error(
        `Invalid calendar date: "${dateStr}". Month must be 01-12 and day must be 01-31.`,
      );
    }
    return null;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    if (throwOnError) {
      throw new Error(
        `Invalid calendar date: "${dateStr}". Date does not exist on calendar.`,
      );
    }
    return null;
  }

  return parsed;
}

/**
 * Parses a YYYY-MM-DD partition date string, throwing descriptive errors on invalid input.
 */
export function parsePartitionDate(dateStr: string): Date {
  const result = validatePartitionDate(dateStr, true);
  if (!result) {
    throw new Error(`Invalid date string: "${dateStr}".`);
  }
  return result;
}

/**
 * Checks if a date string is valid according to YYYY-MM-DD format and calendar validity.
 */
export function isValidDateString(dateStr: string): boolean {
  return validatePartitionDate(dateStr, false) !== null;
}

/**
 * Computes partition boundary dates (start and end UTC Dates) for a given year and month,
 * or from a validated YYYY-MM-DD partition date string.
 */
export function calculatePartitionDates(
  yearOrDate: number | string,
  month?: number,
): { start: Date; end: Date } {
  let y: number;
  let m: number;

  if (typeof yearOrDate === "string") {
    const validDate = parsePartitionDate(yearOrDate);
    y = validDate.getUTCFullYear();
    m = validDate.getUTCMonth();
  } else {
    y = yearOrDate;
    m = month ?? 0;
  }

  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

  const startDate = new Date(Date.UTC(y, m, 1));
  const endDate = new Date(Date.UTC(y, m, lastDay + 1));

  return {
    start: startDate,
    end: endDate,
  };
}

/**
 * Parses partition boundaries from a YYYY-MM-DD date string.
 */
export function parsePartitionBoundaries(
  dateStr: string,
): { start: Date; end: Date } {
  return calculatePartitionDates(dateStr);
}

export function escapeCsv(
  value: string | number | boolean | Date | null | undefined,
  sanitizeFormulas = true,
): string {
  if (value === null || value === undefined) {
    return "";
  }
  let str: string;
  if (value instanceof Date) {
    str = isNaN(value.getTime()) ? "" : value.toISOString();
  } else {
    str = String(value);
  }

  // Formula injection sanitization
  if (sanitizeFormulas && /^[=+\-@\t\r]/.test(str.trimStart())) {
    str = "'" + str;
  }

  if (
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
