import { formatChatTimestamp } from "@/lib/chatTimestamps";

describe("formatChatTimestamp", () => {
  const now = new Date("2026-10-06T12:05:00Z");

  it("formats timestamps as relative time", () => {
    expect(
      formatChatTimestamp(
        new Date("2026-10-06T12:00:00Z").getTime(),
        "relative",
        now,
      ),
    ).toBe("5 minutes ago");
  });

  it("formats timestamps as local exact time", () => {
    const timestamp = new Date("2026-10-06T14:32:00Z");
    expect(formatChatTimestamp(timestamp.getTime(), "exact", now)).toBe(
      timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    );
  });

  it("returns empty string for null, undefined, empty string, or non-finite numbers", () => {
    expect(formatChatTimestamp(null, "relative", now)).toBe("");
    expect(formatChatTimestamp(null, "exact", now)).toBe("");
    expect(formatChatTimestamp(undefined, "relative", now)).toBe("");
    expect(formatChatTimestamp("", "relative", now)).toBe("");
    expect(formatChatTimestamp(NaN, "relative", now)).toBe("");
    expect(formatChatTimestamp(-1000, "relative", now)).toBe("");
    expect(formatChatTimestamp(0, "relative", now)).toBe("");
    expect(formatChatTimestamp(Infinity, "relative", now)).toBe("");
    expect(formatChatTimestamp("invalid-date", "relative", now)).toBe("");
  });

  it("normalizes 10-digit unix seconds timestamps to milliseconds", () => {
    // 2026-10-06T12:00:00Z in seconds is 1791288000
    const secondsTimestamp = Math.floor(
      new Date("2026-10-06T12:00:00Z").getTime() / 1000,
    );
    expect(formatChatTimestamp(secondsTimestamp, "relative", now)).toBe(
      "5 minutes ago",
    );

    // Numeric string seconds
    expect(formatChatTimestamp(String(secondsTimestamp), "relative", now)).toBe(
      "5 minutes ago",
    );
  });

  it("accepts Date instances directly", () => {
    const dateObj = new Date("2026-10-06T11:05:00Z");
    expect(formatChatTimestamp(dateObj, "relative", now)).toBe("1 hour ago");
  });

  it("safely handles invalid now parameter without throwing RangeError", () => {
    const validTimestamp = Date.now() - 60000;
    const invalidNow = new Date(NaN);
    expect(() =>
      formatChatTimestamp(validTimestamp, "relative", invalidNow),
    ).not.toThrow();
  });

  it("clamps minor forward clock drift (< 30s) to current time", () => {
    const futureTimestamp = new Date("2026-10-06T12:05:05Z"); // +5 seconds ahead
    expect(formatChatTimestamp(futureTimestamp, "relative", now)).toBe("now");
  });

  it("formats multi-month and multi-year relative differences", () => {
    const threeMonthsAgo = new Date("2026-07-06T12:05:00Z");
    expect(formatChatTimestamp(threeMonthsAgo, "relative", now)).toBe(
      "3 months ago",
    );

    const twoYearsAgo = new Date("2024-10-06T12:05:00Z");
    expect(formatChatTimestamp(twoYearsAgo, "relative", now)).toBe(
      "2 years ago",
    );
  });
});
