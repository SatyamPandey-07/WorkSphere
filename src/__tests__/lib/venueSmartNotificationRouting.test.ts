/**
 * Tests for smart notification routing based on user behavior.
 */

type NotificationChannel = "push" | "email" | "sms" | "in_app";
type NotificationType = "booking_reminder" | "promo" | "system_alert" | "social";

interface NotificationPreferences {
  userId: string;
  channels: Record<NotificationType, NotificationChannel[]>;
  doNotDisturbStart: number;  // hour 0-23
  doNotDisturbEnd: number;
  timezone: string;
  lastOpenedPush: number | null;
  lastOpenedEmail: number | null;
}

function isDoNotDisturb(prefs: NotificationPreferences, hour: number): boolean {
  const { doNotDisturbStart: start, doNotDisturbEnd: end } = prefs;
  if (start <= end) return hour >= start && hour < end;
  // Wraps midnight
  return hour >= start || hour < end;
}

function getBestChannel(
  prefs: NotificationPreferences,
  type: NotificationType,
  nowMs: number
): NotificationChannel | null {
  const channels = prefs.channels[type];
  if (!channels || channels.length === 0) return null;

  const hour = new Date(nowMs).getUTCHours();
  if (isDoNotDisturb(prefs, hour) && type !== "system_alert") return null;

  // Prefer most recently engaged channel
  if (prefs.lastOpenedPush && channels.includes("push")) return "push";
  if (prefs.lastOpenedEmail && channels.includes("email")) return "email";
  return channels[0];
}

function shouldSendNotification(
  prefs: NotificationPreferences,
  type: NotificationType,
  nowMs: number
): boolean {
  return getBestChannel(prefs, type, nowMs) !== null;
}

const NOW = 1_700_000_000_000;
const PREFS: NotificationPreferences = {
  userId: "u1",
  channels: {
    booking_reminder: ["push", "email"],
    promo:            ["email"],
    system_alert:     ["push", "sms"],
    social:           ["in_app"],
  },
  doNotDisturbStart: 22,  // 10pm - 7am
  doNotDisturbEnd: 7,
  timezone: "UTC",
  lastOpenedPush: NOW - 3600_000, // 1h ago
  lastOpenedEmail: NOW - 86400_000,
};

describe("Smart notification routing", () => {
  it("isDoNotDisturb: hour 23 in 22-7 DND → true", () => {
    expect(isDoNotDisturb(PREFS, 23)).toBe(true);
  });

  it("isDoNotDisturb: hour 6 in 22-7 DND → true (wraps)", () => {
    expect(isDoNotDisturb(PREFS, 6)).toBe(true);
  });

  it("isDoNotDisturb: hour 12 → false", () => {
    expect(isDoNotDisturb(PREFS, 12)).toBe(false);
  });

  it("getBestChannel: push preferred over email (opened more recently)", () => {
    // Create a daytime timestamp
    const daytime = new Date("2026-10-01T12:00:00Z").getTime();
    expect(getBestChannel(PREFS, "booking_reminder", daytime)).toBe("push");
  });

  it("getBestChannel: DND at night → null for non-alert", () => {
    const nighttime = new Date("2026-10-01T23:00:00Z").getTime();
    expect(getBestChannel(PREFS, "promo", nighttime)).toBeNull();
  });

  it("getBestChannel: system_alert bypasses DND", () => {
    const nighttime = new Date("2026-10-01T23:00:00Z").getTime();
    expect(getBestChannel(PREFS, "system_alert", nighttime)).not.toBeNull();
  });

  it("shouldSendNotification: daytime booking reminder → true", () => {
    const daytime = new Date("2026-10-01T12:00:00Z").getTime();
    expect(shouldSendNotification(PREFS, "booking_reminder", daytime)).toBe(true);
  });
});
