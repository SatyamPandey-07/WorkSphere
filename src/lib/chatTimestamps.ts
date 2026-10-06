export type ChatTimestampFormat = "relative" | "exact";

export const CHAT_TIMESTAMP_FORMAT_STORAGE_KEY = "worksphere_chat_timestamp_format";
export const CHAT_TIMESTAMP_FORMAT_CHANGE_EVENT = "worksphere_chat_timestamp_format_change";

export function formatChatTimestamp(
  timestamp: number | string,
  format: ChatTimestampFormat,
  now: Date = new Date(),
): string {
  const parsedTimestamp =
    typeof timestamp === "string" && /^\d+$/.test(timestamp)
      ? Number(timestamp)
      : timestamp;
  const date = new Date(parsedTimestamp);
  if (Number.isNaN(date.getTime())) return "";

  if (format === "exact") {
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const differenceInSeconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const absoluteDifference = Math.abs(differenceInSeconds);
  const [value, unit] =
    absoluteDifference < 60
      ? [differenceInSeconds, "second"]
      : absoluteDifference < 3600
        ? [Math.round(differenceInSeconds / 60), "minute"]
        : absoluteDifference < 86400
          ? [Math.round(differenceInSeconds / 3600), "hour"]
          : [Math.round(differenceInSeconds / 86400), "day"];

  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
    value,
    unit as Intl.RelativeTimeFormatUnit,
  );
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