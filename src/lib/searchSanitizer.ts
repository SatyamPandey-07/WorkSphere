/**
 * Hard ceiling for a single free-text search parameter. Long enough for a full
 * venue name or a short comma-separated list of cities, short enough that a
 * caller cannot hand the database layer an unbounded string.
 */
export const MAX_SEARCH_QUERY_LENGTH = 100;

/**
 * Maximum number of non-empty items extracted from a comma-separated search list
 * (such as the `cities` parameter). Bounds database query complexity and avoids
 * unbounded processing downstream.
 */
export const MAX_SEARCH_LIST_ITEMS = 25;

/**
 * ASCII control characters plus the C1 control block. This covers NUL (\u0000)
 * and ESC (\u001b), the two the search endpoints were seeing arrive via raw
 * query strings, as well as stray tab/newline bytes that some clients append.
 */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * Normalizes a value pulled straight off `searchParams` before it is passed to
 * Prisma. Whitespace is trimmed from both ends, control characters are removed
 * (never replaced, so they cannot be used to break out of a `contains` filter),
 * and the result is capped at MAX_SEARCH_QUERY_LENGTH characters.
 *
 * The function is intentionally pure so it can be unit tested without a request
 * or database connection.
 */
export function sanitizeSearchQuery(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .replace(CONTROL_CHARACTERS, "")
    .trim()
    .slice(0, MAX_SEARCH_QUERY_LENGTH);
}

/**
 * Canonical form of a free-text query for cache key derivation.
 *
 * Every run of whitespace (spaces, tabs, newlines, non-breaking and other
 * Unicode spaces) collapses to a single space, leading and trailing whitespace
 * is dropped, and the result is lowercased. `" Quiet   Cafe "` and
 * `"quiet cafe"` therefore map to the same string and share one cache entry.
 *
 * Uses `toLowerCase` rather than `toLocaleLowerCase` so the result never
 * depends on the server locale.
 */
export function normalizeSearchQuery(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Splits a comma-separated value (currently used for the `cities`
 * parameter) into individual trimmed, non-empty entries.
 *
 * Splits the raw input string by comma first, then sanitizes each entry
 * individually so entries are sanitized without prematurely truncating the entire list.
 * Limits the resulting list to at most MAX_SEARCH_LIST_ITEMS non-empty entries.
 */
export function splitSearchList(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }
  const parts = value.split(",");
  const results: string[] = [];
  for (const part of parts) {
    const sanitized = sanitizeSearchQuery(part);
    if (sanitized) {
      results.push(sanitized);
      if (results.length >= MAX_SEARCH_LIST_ITEMS) {
        break;
      }
    }
  }
  return results;
}
