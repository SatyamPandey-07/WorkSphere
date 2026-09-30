/**
 * Tests for notification grouping by venue or booking.
 */

interface Notification {
  id: string;
  userId: string;
  venueId?: string;
  bookingId?: string;
  type: string;
  message: string;
  createdAt: number;
  read: boolean;
}

function groupNotificationsByVenue(
  notifications: Notification[]
): Record<string, Notification[]> {
  const groups: Record<string, Notification[]> = {};
  for (const n of notifications) {
    const key = n.venueId ?? "other";
    if (!groups[key]) groups[key] = [];
    groups[key].push(n);
  }
  return groups;
}

function groupNotificationsByDate(
  notifications: Notification[]
): Record<string, Notification[]> {
  const groups: Record<string, Notification[]> = {};
  for (const n of notifications) {
    const date = new Date(n.createdAt).toISOString().split("T")[0];
    if (!groups[date]) groups[date] = [];
    groups[date].push(n);
  }
  return groups;
}

function unreadInGroup(notifications: Notification[]): number {
  return notifications.filter((n) => !n.read).length;
}

function markGroupRead(notifications: Notification[]): Notification[] {
  return notifications.map((n) => ({ ...n, read: true }));
}

const NOW = 1_700_000_000_000;
const NOTIFICATIONS: Notification[] = [
  { id: "n1", userId: "u1", venueId: "v1", bookingId: "b1", type: "reminder",  message: "Booking in 1h",       createdAt: NOW - 3000, read: false },
  { id: "n2", userId: "u1", venueId: "v1", bookingId: "b2", type: "confirmed", message: "Booking confirmed",   createdAt: NOW - 2000, read: true  },
  { id: "n3", userId: "u1", venueId: "v2",                  type: "promo",     message: "20% off this week!",  createdAt: NOW - 1000, read: false },
  { id: "n4", userId: "u1",                                  type: "system",   message: "App update available",createdAt: NOW - 500,  read: false },
];

describe("User notification grouping", () => {
  it("groupNotificationsByVenue: v1 has 2", () => {
    const groups = groupNotificationsByVenue(NOTIFICATIONS);
    expect(groups["v1"]).toHaveLength(2);
  });

  it("groupNotificationsByVenue: no venueId → 'other'", () => {
    const groups = groupNotificationsByVenue(NOTIFICATIONS);
    expect(groups["other"]).toHaveLength(1);
  });

  it("unreadInGroup: v1 has 1 unread", () => {
    const groups = groupNotificationsByVenue(NOTIFICATIONS);
    expect(unreadInGroup(groups["v1"])).toBe(1);
  });

  it("markGroupRead: all read after marking", () => {
    const v1 = groupNotificationsByVenue(NOTIFICATIONS)["v1"];
    const marked = markGroupRead(v1);
    expect(unreadInGroup(marked)).toBe(0);
  });

  it("markGroupRead is immutable", () => {
    const v1 = groupNotificationsByVenue(NOTIFICATIONS)["v1"];
    markGroupRead(v1);
    expect(v1.some((n) => !n.read)).toBe(true);
  });

  it("groupNotificationsByDate: all notifications today", () => {
    const groups = groupNotificationsByDate(NOTIFICATIONS);
    const dates = Object.keys(groups);
    expect(dates.length).toBeGreaterThan(0);
  });
});
