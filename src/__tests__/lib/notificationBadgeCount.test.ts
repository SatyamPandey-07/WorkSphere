/**
 * Tests for notification badge unread count logic.
 */

interface Notification {
  id: string;
  read: boolean;
  type: "booking" | "promo" | "system" | "reminder";
}

function unreadCount(notifications: Notification[]): number {
  return notifications.filter((n) => !n.read).length;
}

function unreadByType(
  notifications: Notification[],
  type: Notification["type"]
): number {
  return notifications.filter((n) => !n.read && n.type === type).length;
}

function markAllRead(notifications: Notification[]): Notification[] {
  return notifications.map((n) => ({ ...n, read: true }));
}

function badgeLabel(count: number): string {
  if (count <= 0) return "";
  if (count > 99) return "99+";
  return String(count);
}

const NOTIFS: Notification[] = [
  { id: "n1", read: false, type: "booking" },
  { id: "n2", read: true,  type: "promo" },
  { id: "n3", read: false, type: "booking" },
  { id: "n4", read: false, type: "reminder" },
];

describe("Notification badge count", () => {
  it("unreadCount returns correct total", () => {
    expect(unreadCount(NOTIFS)).toBe(3);
  });

  it("unreadCount on empty array → 0", () => {
    expect(unreadCount([])).toBe(0);
  });

  it("unreadByType: booking unread", () => {
    expect(unreadByType(NOTIFS, "booking")).toBe(2);
  });

  it("unreadByType: promo → 0 (already read)", () => {
    expect(unreadByType(NOTIFS, "promo")).toBe(0);
  });

  it("markAllRead clears unread", () => {
    const marked = markAllRead(NOTIFS);
    expect(unreadCount(marked)).toBe(0);
  });

  it("markAllRead does not mutate original", () => {
    markAllRead(NOTIFS);
    expect(NOTIFS.filter((n) => !n.read)).toHaveLength(3);
  });

  it("badgeLabel: 0 → empty string", () => {
    expect(badgeLabel(0)).toBe("");
  });

  it("badgeLabel: positive count", () => {
    expect(badgeLabel(5)).toBe("5");
  });

  it("badgeLabel: over 99 → '99+'", () => {
    expect(badgeLabel(120)).toBe("99+");
  });

  it("badgeLabel: exactly 99", () => {
    expect(badgeLabel(99)).toBe("99");
  });
});
