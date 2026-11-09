/**
 * Turns an account creation date into a label like "Member since October 2025".
 * Accepts a Date, an ISO string or a timestamp (ms). Returns null when the
 * value is missing or not a valid date, so callers can render nothing.
 */
export function formatMemberSince(
  value: Date | string | number | null | undefined,
  locale: string = "en-US",
): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && (!Number.isFinite(value) || value <= 0)) {
    return null;
  }

  // Doc promises ms, but 10-digit seconds timestamps occur in the wild.
  const normalized =
    typeof value === "number" && value < 1e12 ? value * 1000 : value;
  const date = normalized instanceof Date ? normalized : new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;

  const formatted = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
  }).format(date);

  return `Member since ${formatted}`;
}
