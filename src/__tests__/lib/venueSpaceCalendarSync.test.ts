/**
 * Tests for venue space calendar synchronization with external tools.
 */

type SyncProvider = "google_calendar" | "outlook" | "apple_calendar" | "ical";

interface SpaceCalendarSync {
  syncId: string;
  spaceId: string;
  userId: string;
  provider: SyncProvider;
  externalCalendarId: string;
  syncEnabled: boolean;
  lastSyncedAt: number | null;
  syncIntervalMs: number;
  includePrivateDetails: boolean;
}

function needsSync(sync: SpaceCalendarSync, nowMs: number): boolean {
  if (!sync.syncEnabled) return false;
  if (sync.lastSyncedAt === null) return true;
  return nowMs - sync.lastSyncedAt >= sync.syncIntervalMs;
}

function generateCalendarEventId(
  sync: SpaceCalendarSync,
  bookingId: string
): string {
  return `${sync.syncId}-${bookingId}-${sync.provider}`;
}

function enableSync(sync: SpaceCalendarSync): SpaceCalendarSync {
  return { ...sync, syncEnabled: true };
}

function disableSync(sync: SpaceCalendarSync): SpaceCalendarSync {
  return { ...sync, syncEnabled: false };
}

function markSynced(sync: SpaceCalendarSync, nowMs: number): SpaceCalendarSync {
  return { ...sync, lastSyncedAt: nowMs };
}

function staleSyncs(syncs: SpaceCalendarSync[], nowMs: number): SpaceCalendarSync[] {
  return syncs.filter((s) => needsSync(s, nowMs));
}

const NOW = 1_700_000_000_000;
const SYNC: SpaceCalendarSync = {
  syncId: "sc1", spaceId: "sp1", userId: "u1",
  provider: "google_calendar", externalCalendarId: "cal123",
  syncEnabled: true, lastSyncedAt: NOW - 7_200_000, // 2h ago
  syncIntervalMs: 3_600_000, // sync every 1h
  includePrivateDetails: false,
};

describe("Venue space calendar sync", () => {
  it("needsSync: 2h since last sync, 1h interval → true", () => {
    expect(needsSync(SYNC, NOW)).toBe(true);
  });

  it("needsSync: recently synced → false", () => {
    const fresh = { ...SYNC, lastSyncedAt: NOW - 1000 };
    expect(needsSync(fresh, NOW)).toBe(false);
  });

  it("needsSync: disabled → false", () => {
    expect(needsSync({ ...SYNC, syncEnabled: false }, NOW)).toBe(false);
  });

  it("needsSync: never synced → true", () => {
    expect(needsSync({ ...SYNC, lastSyncedAt: null }, NOW)).toBe(true);
  });

  it("generateCalendarEventId: includes syncId and provider", () => {
    const id = generateCalendarEventId(SYNC, "b1");
    expect(id).toContain("sc1");
    expect(id).toContain("google_calendar");
  });

  it("enableSync: sets syncEnabled = true", () => {
    const disabled = disableSync(SYNC);
    expect(enableSync(disabled).syncEnabled).toBe(true);
  });

  it("markSynced: updates lastSyncedAt", () => {
    const synced = markSynced(SYNC, NOW);
    expect(synced.lastSyncedAt).toBe(NOW);
  });

  it("staleSyncs: returns syncs that need syncing", () => {
    const syncs = [SYNC, { ...SYNC, syncId: "sc2", lastSyncedAt: NOW - 100 }];
    const stale = staleSyncs(syncs, NOW);
    expect(stale).toHaveLength(1);
    expect(stale[0].syncId).toBe("sc1");
  });
});
