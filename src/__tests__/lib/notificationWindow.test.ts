import { isWithinNotificationWindow } from "../../lib/notificationWindow";

describe("isWithinNotificationWindow", () => {
  it("returns true if start or end is not defined", () => {
    const now = new Date();
    expect(isWithinNotificationWindow(now, null, null, "UTC")).toBe(true);
    expect(isWithinNotificationWindow(now, "09:00", null, "UTC")).toBe(true);
    expect(isWithinNotificationWindow(now, null, "17:00", "UTC")).toBe(true);
  });

  it("checks window boundaries correctly inside normal daytime window", () => {
    const dateAtNoonUTC = new Date("2026-07-16T12:00:00Z");

    // In UTC, 12:00 is between 09:00 and 17:00
    expect(
      isWithinNotificationWindow(dateAtNoonUTC, "09:00", "17:00", "UTC"),
    ).toBe(true);

    // In UTC, 12:00 is not between 13:00 and 17:00
    expect(
      isWithinNotificationWindow(dateAtNoonUTC, "13:00", "17:00", "UTC"),
    ).toBe(false);
  });

  it("handles timezone offsets correctly", () => {
    const dateAtNoonUTC = new Date("2026-07-16T12:00:00Z");

    // America/New_York is UTC-4 in July (EDT) -> 12:00 UTC is 08:00 EDT.
    // 08:00 is outside 09:00 - 17:00
    expect(
      isWithinNotificationWindow(
        dateAtNoonUTC,
        "09:00",
        "17:00",
        "America/New_York",
      ),
    ).toBe(false);

    // In Asia/Kolkata (UTC+5:30), 12:00 UTC is 17:30.
    // 17:30 is outside 09:00 - 17:00
    expect(
      isWithinNotificationWindow(
        dateAtNoonUTC,
        "09:00",
        "17:00",
        "Asia/Kolkata",
      ),
    ).toBe(false);
    // 17:30 is inside 09:00 - 18:00
    expect(
      isWithinNotificationWindow(
        dateAtNoonUTC,
        "09:00",
        "18:00",
        "Asia/Kolkata",
      ),
    ).toBe(true);
  });

  it("handles overnight windows where start time is greater than end time", () => {
    const lateNightUTC = new Date("2026-07-16T23:00:00Z");

    // Window from 22:00 to 06:00
    expect(
      isWithinNotificationWindow(lateNightUTC, "22:00", "06:00", "UTC"),
    ).toBe(true);

    // 2026-07-16T02:00:00Z is 02:00 UTC (inside 22:00 to 06:00 overnight window)
    const earlyMorningUTC = new Date("2026-07-16T02:00:00Z");
    expect(
      isWithinNotificationWindow(earlyMorningUTC, "22:00", "06:00", "UTC"),
    ).toBe(true);

    // 2026-07-16T12:00:00Z is 12:00 UTC (outside 22:00 to 06:00 overnight window)
    const noonUTC = new Date("2026-07-16T12:00:00Z");
    expect(isWithinNotificationWindow(noonUTC, "22:00", "06:00", "UTC")).toBe(
      false,
    );
  });
});
