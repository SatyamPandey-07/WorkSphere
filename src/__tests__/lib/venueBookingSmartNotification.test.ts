/**
 * Tests for smart notification scheduling and suppression logic.
 */

interface NotificationPreference {
  userId: string;
  channel: "email" | "sms" | "push" | "in_app";
  quietHoursStart: number; // hour 0-23
  quietHoursEnd: number;
  timezone: string;
  doNotDisturb: boolean;
  maxPerDay: number;
}

interface ScheduledNotification {
  id: string;
  userId: string;
  channel: "email" | "sms" | "push" | "in_app";
  priority: "low" | "medium" | "high" | "critical";
  scheduledFor: number;
  sentAt: number | null;
  suppressed: boolean;
}

function isQuietHour(hour: number, pref: NotificationPreference): boolean {
  const { quietHoursStart: start, quietHoursEnd: end } = pref;
  if (start <= end) return hour >= start && hour < end;
  return hour >= start || hour < end; // wraps midnight
}

function shouldSuppress(
  notification: ScheduledNotification,
  pref: NotificationPreference,
  scheduledHour: number
): boolean {
  if (pref.doNotDisturb && notification.priority !== "critical") return true;
  if (notification.channel !== pref.channel) return false;
  if (notification.priority === "critical") return false;
  return isQuietHour(scheduledHour, pref);
}

function dailySentCount(notifications: ScheduledNotification[], userId: string, date: string): number {
  return notifications.filter(
    (n) => n.userId === userId && n.sentAt !== null && !n.suppressed &&
      new Date(n.sentAt).toISOString().startsWith(date)
  ).length;
}

function exceededDailyLimit(
  notifications: ScheduledNotification[],
  pref: NotificationPreference,
  date: string
): boolean {
  return dailySentCount(notifications, pref.userId, date) >= pref.maxPerDay;
}

function pendingNotifications(notifications: ScheduledNotification[]): ScheduledNotification[] {
  return notifications.filter((n) => n.sentAt === null && !n.suppressed);
}

const PREF: NotificationPreference = {
  userId: "u1", channel: "push",
  quietHoursStart: 22, quietHoursEnd: 8,
  timezone: "Europe/London", doNotDisturb: false, maxPerDay: 5,
};

describe("Smart notification scheduling", () => {
  it("isQuietHour: 23:00 → quiet", () => {
    expect(isQuietHour(23, PREF)).toBe(true);
  });

  it("isQuietHour: 14:00 → not quiet", () => {
    expect(isQuietHour(14, PREF)).toBe(false);
  });

  it("isQuietHour: 03:00 → quiet (overnight)", () => {
    expect(isQuietHour(3, PREF)).toBe(true);
  });

  it("shouldSuppress: low priority during quiet hours → suppressed", () => {
    const n: ScheduledNotification = { id: "n1", userId: "u1", channel: "push", priority: "low", scheduledFor: 0, sentAt: null, suppressed: false };
    expect(shouldSuppress(n, PREF, 23)).toBe(true);
  });

  it("shouldSuppress: critical during quiet hours → not suppressed", () => {
    const n: ScheduledNotification = { id: "n2", userId: "u1", channel: "push", priority: "critical", scheduledFor: 0, sentAt: null, suppressed: false };
    expect(shouldSuppress(n, PREF, 23)).toBe(false);
  });

  it("pendingNotifications: returns unsent and unsuppressed", () => {
    const list: ScheduledNotification[] = [
      { id: "n1", userId: "u1", channel: "push", priority: "medium", scheduledFor: 0, sentAt: null,        suppressed: false },
      { id: "n2", userId: "u1", channel: "push", priority: "low",    scheduledFor: 0, sentAt: 1_700_000_000_000, suppressed: false },
      { id: "n3", userId: "u1", channel: "push", priority: "high",   scheduledFor: 0, sentAt: null,        suppressed: true },
    ];
    expect(pendingNotifications(list).length).toBe(1);
  });
});
