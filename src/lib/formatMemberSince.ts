/**
 * Turns an account creation date into a label like "Member since October 2025".
 * Accepts a Date, an ISO string or a timestamp (ms). Returns null when the
 * value is missing or not a valid date, so callers can render nothing.
 *
 * If an invalid locale is provided, falls back gracefully to "en-US".
 * Supports an optional custom prefix (defaults to "Member since").
 */
export function formatMemberSince(
  value: Date | string | number | null | undefined,
  locale: string = "en-US",
  prefix: string = "Member since",
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

  const options: Intl.DateTimeFormatOptions = {
    month: "long",
    year: "numeric",
  };

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat(locale, options);
  } catch (err) {
    if (err instanceof RangeError) {
      formatter = new Intl.DateTimeFormat("en-US", options);
    } else {
      throw err;
    }
  }

  const formatted = formatter.format(date);

  return `${prefix} ${formatted}`;
}
