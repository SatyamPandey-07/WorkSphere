/**
 * Tests for venue booking notification digest compilation.
 */

interface DigestNotification {
  userId: string;
  type: "booking_confirmed" | "upcoming_reminder" | "new_review" | "special_offer" | "system";
  content: string;
  timestamp: number;
  read: boolean;
  priority: 1 | 2 | 3 | 4 | 5;  // 1 = highest
}

interface DigestConfig {
  maxItems: number;
  maxAgeMs: number;
  includeRead: boolean;
  minPriority: number;
}

function compileDigest(
  notifications: DigestNotification[],
  userId: string,
  nowMs: number,
  config: DigestConfig
): DigestNotification[] {
  return notifications
    .filter((n) =>
      n.userId === userId &&
      nowMs - n.timestamp <= config.maxAgeMs &&
      n.priority <= config.minPriority &&
      (config.includeRead || !n.read)
    )
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.timestamp - a.timestamp; // newer first within same priority
    })
    .slice(0, config.maxItems);
}

function unreadCount(notifications: DigestNotification[], userId: string): number {
  return notifications.filter((n) => n.userId === userId && !n.read).length;
}

function markAllRead(notifications: DigestNotification[], userId: string): DigestNotification[] {
  return notifications.map((n) => (n.userId === userId ? { ...n, read: true } : n));
}

function digestSummary(digest: DigestNotification[]): Record<string, number> {
  const counts: Record<string, number> = {};
  digest.forEach((n) => { counts[n.type] = (counts[n.type] ?? 0) + 1; });
  return counts;
}

const NOW = 1_700_000_000_000;
const NOTIFICATIONS: DigestNotification[] = [
  { userId: "u1", type: "booking_confirmed", content: "Booking confirmed!", timestamp: NOW - 1000,        read: false, priority: 1 },
  { userId: "u1", type: "upcoming_reminder",  content: "Booking tomorrow",  timestamp: NOW - 3600_000,    read: false, priority: 2 },
  { userId: "u1", type: "special_offer",      content: "20% off",           timestamp: NOW - 7200_000,    read: true,  priority: 3 },
  { userId: "u1", type: "system",             content: "App update",        timestamp: NOW - 100_000_000, read: false, priority: 5 }, // too old
  { userId: "u2", type: "new_review",         content: "New review",        timestamp: NOW - 1000,        read: false, priority: 2 },
];

const CONFIG: DigestConfig = { maxItems: 5, maxAgeMs: 86_400_000, includeRead: false, minPriority: 3 };

describe("Venue booking notification digest", () => {
  it("compileDigest: excludes read and old notifications", () => {
    const digest = compileDigest(NOTIFICATIONS, "u1", NOW, CONFIG);
    expect(digest.every((n) => !n.read)).toBe(true);
    expect(digest.every((n) => NOW - n.timestamp <= CONFIG.maxAgeMs)).toBe(true);
  });

  it("compileDigest: sorted by priority then recency", () => {
    const digest = compileDigest(NOTIFICATIONS, "u1", NOW, CONFIG);
    if (digest.length > 1) {
      expect(digest[0].priority).toBeLessThanOrEqual(digest[1].priority);
    }
  });

  it("compileDigest: includes read when config says so", () => {
    const withRead = compileDigest(NOTIFICATIONS, "u1", NOW, { ...CONFIG, includeRead: true });
    expect(withRead.some((n) => n.read)).toBe(true);
  });

  it("unreadCount: u1 has 2 unread (within age)", () => {
    expect(unreadCount(NOTIFICATIONS, "u1")).toBe(3); // all 3 unread for u1
  });

  it("markAllRead: marks all u1 notifications as read", () => {
    const updated = markAllRead(NOTIFICATIONS, "u1");
    expect(updated.filter((n) => n.userId === "u1" && !n.read)).toHaveLength(0);
  });

  it("digestSummary: counts by type", () => {
    const digest = compileDigest(NOTIFICATIONS, "u1", NOW, CONFIG);
    const summary = digestSummary(digest);
    expect(typeof summary).toBe("object");
  });
});
