/**
 * Tests for user activity feed aggregation and filtering.
 */

type ActivityType = "booking" | "review" | "checkin" | "badge" | "follow";

interface ActivityItem {
  id: string;
  userId: string;
  type: ActivityType;
  entityId: string;
  createdAt: number;
  isPublic: boolean;
}

function publicActivities(items: ActivityItem[]): ActivityItem[] {
  return items.filter((a) => a.isPublic);
}

function activitiesByType(items: ActivityItem[], type: ActivityType): ActivityItem[] {
  return items.filter((a) => a.type === type);
}

function recentActivities(
  items: ActivityItem[],
  userId: string,
  limit: number
): ActivityItem[] {
  return items
    .filter((a) => a.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

function activitySummary(
  items: ActivityItem[],
  userId: string
): Record<ActivityType, number> {
  const types: ActivityType[] = ["booking", "review", "checkin", "badge", "follow"];
  const counts = Object.fromEntries(types.map((t) => [t, 0])) as Record<ActivityType, number>;
  items.filter((a) => a.userId === userId).forEach((a) => counts[a.type]++);
  return counts;
}

const NOW = 1_700_000_000_000;
const ITEMS: ActivityItem[] = [
  { id: "a1", userId: "u1", type: "booking",  entityId: "b1", createdAt: NOW - 1000,  isPublic: true  },
  { id: "a2", userId: "u1", type: "review",   entityId: "r1", createdAt: NOW - 2000,  isPublic: true  },
  { id: "a3", userId: "u1", type: "checkin",  entityId: "c1", createdAt: NOW - 3000,  isPublic: false },
  { id: "a4", userId: "u2", type: "badge",    entityId: "bg1",createdAt: NOW - 500,   isPublic: true  },
  { id: "a5", userId: "u1", type: "booking",  entityId: "b2", createdAt: NOW - 500,   isPublic: true  },
];

describe("User activity feed", () => {
  it("publicActivities filters private", () => {
    expect(publicActivities(ITEMS)).toHaveLength(4);
  });

  it("activitiesByType: booking", () => {
    expect(activitiesByType(ITEMS, "booking")).toHaveLength(2);
  });

  it("activitiesByType: follow → 0", () => {
    expect(activitiesByType(ITEMS, "follow")).toHaveLength(0);
  });

  it("recentActivities: limited by count", () => {
    const recent = recentActivities(ITEMS, "u1", 2);
    expect(recent).toHaveLength(2);
  });

  it("recentActivities: ordered most recent first", () => {
    const recent = recentActivities(ITEMS, "u1", 5);
    expect(recent[0].createdAt).toBeGreaterThan(recent[1].createdAt);
  });

  it("recentActivities: filters to user", () => {
    const recent = recentActivities(ITEMS, "u2", 10);
    expect(recent.every((a) => a.userId === "u2")).toBe(true);
  });

  it("activitySummary counts by type", () => {
    const summary = activitySummary(ITEMS, "u1");
    expect(summary.booking).toBe(2);
    expect(summary.review).toBe(1);
    expect(summary.badge).toBe(0);
  });
});
