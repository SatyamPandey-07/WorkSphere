/**
 * Normalizes a required free-text identifier from an amenity vote request body.
 *
 * Returns the trimmed string, or `null` when the value is not a string or is
 * empty after trimming. Callers treat `null` as a missing parameter, so
 * whitespace-only input (e.g. "   " or "\n") is rejected instead of creating
 * an AmenityValidation row with a blank amenity name.
 */
export function normalizeRequiredText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
