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

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const formatted = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
  }).format(date);

  return `Member since ${formatted}`;
}
