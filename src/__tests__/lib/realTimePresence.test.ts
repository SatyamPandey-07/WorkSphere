/**
 * Tests for real-time user presence tracking in a workspace.
 */

interface PresenceEntry {
  userId: string;
  roomId: string;
  joinedAt: number;
  lastSeenAt: number;
  status: "active" | "idle" | "away";
}

function isOnline(entry: PresenceEntry, nowMs: number, idleThresholdMs = 60_000): boolean {
  return nowMs - entry.lastSeenAt < idleThresholdMs;
}

function getStatus(entry: PresenceEntry, nowMs: number): "active" | "idle" | "offline" {
  const elapsed = nowMs - entry.lastSeenAt;
  if (elapsed >= 300_000) return "offline";
  if (elapsed >= 60_000)  return "idle";
  return "active";
}

function activeInRoom(entries: PresenceEntry[], roomId: string, nowMs: number): PresenceEntry[] {
  return entries.filter((e) => e.roomId === roomId && isOnline(e, nowMs));
}

function oldestMember(entries: PresenceEntry[], roomId: string): PresenceEntry | null {
  const room = entries.filter((e) => e.roomId === roomId);
  if (room.length === 0) return null;
  return room.reduce((oldest, e) => e.joinedAt < oldest.joinedAt ? e : oldest);
}

const NOW = 1_700_000_000_000;
const ENTRIES: PresenceEntry[] = [
  { userId: "u1", roomId: "r1", joinedAt: NOW - 3600_000, lastSeenAt: NOW - 10_000,  status: "active" },
  { userId: "u2", roomId: "r1", joinedAt: NOW - 1800_000, lastSeenAt: NOW - 120_000, status: "idle"   },
  { userId: "u3", roomId: "r2", joinedAt: NOW - 600_000,  lastSeenAt: NOW - 5_000,   status: "active" },
];

describe("Real-time user presence", () => {
  it("online when last seen < 60s ago", () => {
    expect(isOnline(ENTRIES[0], NOW)).toBe(true);
  });

  it("offline when last seen ≥ 60s ago", () => {
    expect(isOnline(ENTRIES[1], NOW)).toBe(false);
  });

  it("getStatus active < 60s", () => {
    expect(getStatus(ENTRIES[0], NOW)).toBe("active");
  });

  it("getStatus idle 60–299s", () => {
    expect(getStatus(ENTRIES[1], NOW)).toBe("idle");
  });

  it("getStatus offline ≥ 300s", () => {
    const gone: PresenceEntry = { userId: "u4", roomId: "r1", joinedAt: NOW - 600_000, lastSeenAt: NOW - 310_000, status: "away" };
    expect(getStatus(gone, NOW)).toBe("offline");
  });

  it("activeInRoom returns only online members of that room", () => {
    const active = activeInRoom(ENTRIES, "r1", NOW);
    expect(active.map((e) => e.userId)).toEqual(["u1"]);
  });

  it("activeInRoom different room", () => {
    const active = activeInRoom(ENTRIES, "r2", NOW);
    expect(active).toHaveLength(1);
  });

  it("oldestMember returns earliest joinedAt", () => {
    expect(oldestMember(ENTRIES, "r1")!.userId).toBe("u1");
  });

  it("oldestMember unknown room → null", () => {
    expect(oldestMember(ENTRIES, "r99")).toBeNull();
  });
});
