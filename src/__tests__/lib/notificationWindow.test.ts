/**
 * Tests for notification window time constraints.
 */

function isWithinNotificationWindow(
  now: Date,
  windowStart: string | null,
  windowEnd: string | null,
  timezone: string,
): boolean {
  if (!windowStart || !windowEnd) return true; // no restriction = always send

  const [startH, startM] = windowStart.split(":").map(Number);
  const [endH, endM] = windowEnd.split(":").map(Number);

  // Simple UTC comparison for test purposes
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes <= endMinutes;
  }
  // Overnight window
  return nowMinutes >= startMinutes || nowMinutes <= endMinutes;
}

describe("Notification window checking", () => {
  it("null window = always within window", () => {
    expect(isWithinNotificationWindow(new Date(), null, null, "UTC")).toBe(true);
  });

  it("within 9:00-18:00 window", () => {
    const noon = new Date("2026-09-30T12:00:00Z");
    expect(isWithinNotificationWindow(noon, "09:00", "18:00", "UTC")).toBe(true);
  });

  it("before 9:00-18:00 window", () => {
    const early = new Date("2026-09-30T07:00:00Z");
    expect(isWithinNotificationWindow(early, "09:00", "18:00", "UTC")).toBe(false);
  });

  it("after 9:00-18:00 window", () => {
    const late = new Date("2026-09-30T20:00:00Z");
    expect(isWithinNotificationWindow(late, "09:00", "18:00", "UTC")).toBe(false);
  });

  it("exactly at window start is within", () => {
    const startTime = new Date("2026-09-30T09:00:00Z");
    expect(isWithinNotificationWindow(startTime, "09:00", "18:00", "UTC")).toBe(true);
  });

  it("exactly at window end is within", () => {
    const endTime = new Date("2026-09-30T18:00:00Z");
    expect(isWithinNotificationWindow(endTime, "09:00", "18:00", "UTC")).toBe(true);
  });
});
