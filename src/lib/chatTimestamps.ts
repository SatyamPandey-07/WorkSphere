export type ChatTimestampFormat = "relative" | "exact";

export const CHAT_TIMESTAMP_FORMAT_STORAGE_KEY = "worksphere_chat_timestamp_format";
export const CHAT_TIMESTAMP_FORMAT_CHANGE_EVENT = "worksphere_chat_timestamp_format_change";

export function formatChatTimestamp(
  timestamp: Date | number | string | null | undefined,
  format: ChatTimestampFormat,
  now: Date = new Date(),
): string {
  if (timestamp === null || timestamp === undefined || timestamp === "") {
    return "";
  }

  let normalized: number | string | Date = timestamp;

  // Handle string numeric timestamps
  if (typeof normalized === "string" && /^\d+$/.test(normalized)) {
    normalized = Number(normalized);
  }

  // Handle numbers: reject non-finite and negative/zero numbers
  if (typeof normalized === "number") {
    if (!Number.isFinite(normalized) || normalized <= 0) {
      return "";
    }
    // 10-digit seconds timestamps (< 1e12) normalized to milliseconds
    if (normalized < 1e12) {
      normalized = normalized * 1000;
    }
  }

  const date = normalized instanceof Date ? normalized : new Date(normalized);
  if (Number.isNaN(date.getTime())) return "";

  // Sanitize now: default to current date if now is invalid
  const safeNow =
    now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();

  if (format === "exact") {
    if (date.toDateString() === safeNow.toDateString()) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  let differenceInSeconds = Math.round((date.getTime() - safeNow.getTime()) / 1000);

  // Slight clock drift into the future (< 30 seconds) is treated as present
  if (differenceInSeconds > 0 && differenceInSeconds < 30) {
    differenceInSeconds = 0;
  }

  const absoluteDifference = Math.abs(differenceInSeconds);

  let value: number;
  let unit: Intl.RelativeTimeFormatUnit;

  if (absoluteDifference < 60) {
    value = differenceInSeconds;
    unit = "second";
  } else if (absoluteDifference < 3600) {
    value = Math.round(differenceInSeconds / 60);
    unit = "minute";
  } else if (absoluteDifference < 86400) {
    value = Math.round(differenceInSeconds / 3600);
    unit = "hour";
  } else if (absoluteDifference < 86400 * 30) {
    value = Math.round(differenceInSeconds / 86400);
    unit = "day";
  } else if (absoluteDifference < 86400 * 365) {
    value = Math.round(differenceInSeconds / (86400 * 30));
    unit = "month";
  } else {
    value = Math.round(differenceInSeconds / (86400 * 365));
    unit = "year";
  }

  try {
    return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
      value,
      unit,
    );
  } catch {
    return date.toLocaleDateString();
  }
}

export function getChatTimestampFormat(): ChatTimestampFormat {
  if (typeof window === "undefined") return "relative";
  try {
    return localStorage.getItem(CHAT_TIMESTAMP_FORMAT_STORAGE_KEY) === "exact"
      ? "exact"
      : "relative";
  } catch {
    return "relative";
  }
}

export function setChatTimestampFormat(format: ChatTimestampFormat): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CHAT_TIMESTAMP_FORMAT_STORAGE_KEY, format);
    window.dispatchEvent(
      new CustomEvent<ChatTimestampFormat>(CHAT_TIMESTAMP_FORMAT_CHANGE_EVENT, {
        detail: format,
      }),
    );
  } catch {
    // Storage can be unavailable in private browsing contexts.
  }
}
