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
export function parsePartitionBoundaries(dateStr: string): {
  start: Date;
  end: Date;
} {
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

/**
 * Sanitizes table names and export partition filenames.
 * - Guards against path traversal (../ or ..\)
 * - Strips directory separators
 * - Replaces whitespace and unsafe characters with underscores
 * - Escapes double quotes for safe Content-Disposition headers
 */
export function sanitizeExportFilename(
  name: string,
  fallback = "export",
): string {
  if (!name || typeof name !== "string") {
    return fallback;
  }

  // Remove path traversal sequences (../, ..\, etc.)
  let sanitized = name.replace(/\.\.+[/\\]?/g, "");

  // Replace directory separators (/ and \) with underscore
  sanitized = sanitized.replace(/[/\\]+/g, "_");

  // Replace whitespace, control characters, and unsafe header characters with underscore
  sanitized = sanitized.replace(/[\s"';,&=?*:<>/\\|%^#@![\]{}()+`~]+/g, "_");

  // Trim leading/trailing underscores and dots
  sanitized = sanitized.replace(/^[_.]+|[_.]+$/g, "");

  return sanitized || fallback;
}

export const ISO_8601_REGEX =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Validates an ISO 8601 date or timestamp string.
 * Supports full ISO 8601 strings (e.g., "2026-10-12T02:14:05.123Z", "2026-10-12T02:14:05Z", "2026-10-12")
 * and validates calendar date and clock validity.
 * Returns Date on success, null on invalid input (or throws if throwOnError is true).
 */
export function validateIso8601Timestamp(
  timestampStr: string,
  throwOnError = false,
): Date | null {
  if (typeof timestampStr !== "string" || !ISO_8601_REGEX.test(timestampStr)) {
    if (throwOnError) {
      throw new Error(
        `Invalid ISO 8601 timestamp format: "${timestampStr}". Expected ISO 8601 format (e.g. YYYY-MM-DDTHH:mm:ssZ).`,
      );
    }
    return null;
  }

  const [datePart, timePartWithTz] = timestampStr.split(/[T ]/);
  const [yearStr, monthStr, dayStr] = datePart.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    if (throwOnError) {
      throw new Error(
        `Invalid calendar date in timestamp: "${timestampStr}". Month must be 01-12 and day must be 01-31.`,
      );
    }
    return null;
  }

  const maxDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > maxDays) {
    if (throwOnError) {
      throw new Error(
        `Invalid calendar date: "${timestampStr}". Day ${day} does not exist in month ${month} of year ${year}.`,
      );
    }
    return null;
  }

  if (timePartWithTz) {
    const timeClean = timePartWithTz.replace(/(?:Z|[+-]\d{2}:?\d{2})$/, "");
    const [hStr, mStr, sStr] = timeClean.split(":");
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    const s = parseFloat(sStr);
    if (h < 0 || h > 23 || m < 0 || m > 59 || s < 0 || s >= 60) {
      if (throwOnError) {
        throw new Error(
          `Invalid time in timestamp: "${timestampStr}". Hours must be 0-23, minutes 0-59, seconds 0-59.`,
        );
      }
      return null;
    }
  }

  const parsed = new Date(timestampStr);
  if (isNaN(parsed.getTime())) {
    if (throwOnError) {
      throw new Error(`Invalid ISO 8601 timestamp: "${timestampStr}".`);
    }
    return null;
  }

  return parsed;
}

/**
 * Parses an ISO 8601 timestamp string, throwing descriptive errors on invalid input.
 */
export function parseIso8601Timestamp(timestampStr: string): Date {
  const result = validateIso8601Timestamp(timestampStr, true);
  if (!result) {
    throw new Error(`Invalid ISO 8601 timestamp: "${timestampStr}".`);
  }
  return result;
}

/**
 * Checks if a string is a valid ISO 8601 timestamp according to format and calendar validity.
 */
export function isValidIso8601Timestamp(timestampStr: string): boolean {
  return validateIso8601Timestamp(timestampStr, false) !== null;
}

// Aliases for convenience
export const validateIsoTimestamp = validateIso8601Timestamp;
export const parseIsoTimestamp = parseIso8601Timestamp;
export const isValidIsoTimestamp = isValidIso8601Timestamp;

export interface AuditLogFilterOptions {
  actorId?: string | null;
  adminId?: string | null;
  startDate?: string | Date | null;
  endDate?: string | Date | null;
  actionType?: string | null;
  action?: string | null;
  entityType?: string | null;
  startParamIndex?: number;
}

export interface AuditLogFilterResult {
  whereClause: string;
  conditions: string[];
  params: (string | Date)[];
  nextParamIndex: number;
}

/**
 * Constructs indexed SQL filter conditions for audit log tables (e.g. AdminAuditLog).
 * Optimizes for partition pruning on range-partitioned "createdAt" and indexed columns.
 * Generates parameterized SQL conditions using $1, $2... placeholders.
 */
export function constructAuditLogFilterConditions(
  options: AuditLogFilterOptions = {},
): AuditLogFilterResult {
  const conditions: string[] = [];
  const params: (string | Date)[] = [];
  let paramIdx = options.startParamIndex ?? 1;

  // 1. startDate filter (indexed on "createdAt")
  if (options.startDate) {
    let startVal: Date;
    if (options.startDate instanceof Date) {
      startVal = options.startDate;
    } else {
      startVal = parseIso8601Timestamp(options.startDate);
    }
    conditions.push(`"createdAt" >= $${paramIdx}::timestamp`);
    params.push(startVal.toISOString());
    paramIdx++;
  }

  // 2. endDate filter (indexed on "createdAt")
  if (options.endDate) {
    let endVal: Date;
    if (options.endDate instanceof Date) {
      endVal = options.endDate;
    } else {
      endVal = parseIso8601Timestamp(options.endDate);
    }
    conditions.push(`"createdAt" <= $${paramIdx}::timestamp`);
    params.push(endVal.toISOString());
    paramIdx++;
  }

  // 3. actorId / adminId filter
  const targetActorId = options.actorId ?? options.adminId;
  if (
    targetActorId &&
    typeof targetActorId === "string" &&
    targetActorId.trim() !== ""
  ) {
    conditions.push(`"adminId" = $${paramIdx}`);
    params.push(targetActorId.trim());
    paramIdx++;
  }

  // 4. actionType / action filter
  const targetAction = options.actionType ?? options.action;
  if (
    targetAction &&
    typeof targetAction === "string" &&
    targetAction.trim() !== ""
  ) {
    conditions.push(`"action" = $${paramIdx}`);
    params.push(targetAction.trim());
    paramIdx++;
  }

  // 5. entityType filter (optional)
  if (
    options.entityType &&
    typeof options.entityType === "string" &&
    options.entityType.trim() !== ""
  ) {
    conditions.push(`"entityType" = $${paramIdx}`);
    params.push(options.entityType.trim());
    paramIdx++;
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  return {
    whereClause,
    conditions,
    params,
    nextParamIndex: paramIdx,
  };
}

export const buildAuditLogFilterConditions = constructAuditLogFilterConditions;
