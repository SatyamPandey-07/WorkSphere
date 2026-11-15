import "fake-indexeddb/auto";
import {
  compactTombstones,
  isTombstoneCompactionSafe,
  isVectorClockMerged,
  isTombstoneRecord,
  createTombstoneCompactorWorker,
  DEFAULT_TOMBSTONE_MAX_AGE_MS,
  CrdtTombstoneRecord,
} from "@/lib/offline/tombstoneCompactor";

describe("IndexedDB Tombstone Compaction & Garbage Collection (#6488)", () => {
  const DB_NAME = "test-crdt-compaction-db";
  let db: IDBDatabase;

  const now = 1700000000000; // Fixed timestamp reference
  const thirtyOneDaysMs = 31 * 24 * 60 * 60 * 1000;
  const tenDaysMs = 10 * 24 * 60 * 60 * 1000;

  async function openTestDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(`${DB_NAME}-${Math.random()}`, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains("crdt_tombstones")) {
          const store = d.createObjectStore("crdt_tombstones", { keyPath: "id" });
          store.createIndex("deletedAt", "deletedAt", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function populateRecords(database: IDBDatabase, records: CrdtTombstoneRecord[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = database.transaction("crdt_tombstones", "readwrite");
      const store = tx.objectStore("crdt_tombstones");
      for (const r of records) {
        store.put(r);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getAllRecords(database: IDBDatabase): Promise<CrdtTombstoneRecord[]> {
    return new Promise((resolve, reject) => {
      const tx = database.transaction("crdt_tombstones", "readonly");
      const store = tx.objectStore("crdt_tombstones");
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  beforeEach(async () => {
    db = await openTestDatabase();
  });

  afterEach(() => {
    db.close();
  });

  describe("Tombstone Evaluation Logic", () => {
    it("identifies tombstone records across various deletion formats", () => {
      expect(isTombstoneRecord({ id: "1", deleted: true })).toBe(true);
      expect(isTombstoneRecord({ id: "2", isDeleted: true })).toBe(true);
      expect(isTombstoneRecord({ id: "3", tombstone: true })).toBe(true);
      expect(isTombstoneRecord({ id: "4", type: "DELETE" })).toBe(true);
      expect(isTombstoneRecord({ id: "5", status: "deleted" })).toBe(true);

      // Non-tombstones
      expect(isTombstoneRecord({ id: "6", deleted: false })).toBe(false);
      expect(isTombstoneRecord({ id: "7", title: "Active Note" })).toBe(false);
      expect(isTombstoneRecord(null)).toBe(false);
    });

    it("evaluates safe vs unsafe tombstones", () => {
      // Safe: > 30 days old and merged
      const safeRecord: CrdtTombstoneRecord = {
        id: "tomb-1",
        deleted: true,
        deletedAt: now - thirtyOneDaysMs,
        isMerged: true,
        vectorClock: { nodeA: 2 },
      };
      expect(isTombstoneCompactionSafe(safeRecord, DEFAULT_TOMBSTONE_MAX_AGE_MS, now)).toEqual({
        canCompact: true,
      });

      // Unsafe: Younger than 30 days
      const youngRecord: CrdtTombstoneRecord = {
        id: "tomb-2",
        deleted: true,
        deletedAt: now - tenDaysMs,
        isMerged: true,
      };
      expect(isTombstoneCompactionSafe(youngRecord, DEFAULT_TOMBSTONE_MAX_AGE_MS, now)).toEqual({
        canCompact: false,
        reason: "too_young",
      });

      // Unsafe: Older than 30 days but has unmerged vector clock branch
      const unmergedRecord: CrdtTombstoneRecord = {
        id: "tomb-3",
        deleted: true,
        deletedAt: now - thirtyOneDaysMs,
        isMerged: false,
      };
      expect(isTombstoneCompactionSafe(unmergedRecord, DEFAULT_TOMBSTONE_MAX_AGE_MS, now)).toEqual({
        canCompact: false,
        reason: "unmerged_branch",
      });
    });
  });

  describe("Vector Clock Merge Protection (#6488)", () => {
    it("prevents compaction when record has unmerged status or flag", () => {
      expect(isVectorClockMerged({ id: "1", isMerged: false })).toBe(false);
      expect(isVectorClockMerged({ id: "2", merged: false })).toBe(false);
      expect(isVectorClockMerged({ id: "3", unmerged: true })).toBe(false);
      expect(isVectorClockMerged({ id: "4", syncStatus: "pending" })).toBe(false);
      expect(isVectorClockMerged({ id: "5", syncStatus: "unmerged" })).toBe(false);
      expect(isVectorClockMerged({ id: "6", syncStatus: "in_flight" })).toBe(false);
      expect(isVectorClockMerged({ id: "7", unmergedBranches: ["branch-nodeB"] })).toBe(false);

      expect(isVectorClockMerged({ id: "8", isMerged: true, syncStatus: "merged" })).toBe(true);
    });

    it("prevents compaction when vector clock branch is ahead of stable vector clock", () => {
      const stableClock = { nodeA: 10, nodeB: 5 };

      // Replicated branch (within stable clock)
      const mergedRecord: CrdtTombstoneRecord = {
        id: "m-1",
        vectorClock: { nodeA: 10, nodeB: 4 },
      };
      expect(isVectorClockMerged(mergedRecord, stableClock)).toBe(true);

      // Unmerged branch (nodeB has unacknowledged tick 6 > 5)
      const unmergedRecord: CrdtTombstoneRecord = {
        id: "u-1",
        vectorClock: { nodeA: 10, nodeB: 6 },
      };
      expect(isVectorClockMerged(unmergedRecord, stableClock)).toBe(false);

      // Unmerged branch (new nodeC not yet seen in stable baseline)
      const unmergedNewNode: CrdtTombstoneRecord = {
        id: "u-2",
        vectorClock: { nodeC: 1 },
      };
      expect(isVectorClockMerged(unmergedNewNode, stableClock)).toBe(false);
    });
  });

  describe("IndexedDB compactTombstones execution", () => {
    it("prunes tombstones older than maxAgeMs and preserves active/young/unmerged records", async () => {
      const records: CrdtTombstoneRecord[] = [
        // 1. Safe to compact: > 30 days old and merged
        {
          id: "tombstone-old-merged",
          deleted: true,
          deletedAt: now - thirtyOneDaysMs,
          isMerged: true,
          vectorClock: { nodeA: 1 },
          payload: "payload-to-reclaim",
        },
        // 2. Unsafe: > 30 days old BUT unmerged vector clock branch (#6488)
        {
          id: "tombstone-old-unmerged",
          deleted: true,
          deletedAt: now - thirtyOneDaysMs,
          isMerged: false,
          vectorClock: { nodeA: 5 },
          payload: "must-be-preserved",
        },
        // 3. Unsafe: < 30 days old (young tombstone)
        {
          id: "tombstone-recent",
          deleted: true,
          deletedAt: now - tenDaysMs,
          isMerged: true,
          vectorClock: { nodeA: 1 },
        },
        // 4. Active item (not a tombstone)
        {
          id: "active-note-1",
          deleted: false,
          timestamp: now - thirtyOneDaysMs,
          vectorClock: { nodeA: 1 },
        },
      ];

      await populateRecords(db, records);

      const result = await compactTombstones(db, DEFAULT_TOMBSTONE_MAX_AGE_MS, {
        currentTime: now,
        stores: ["crdt_tombstones"],
      });

      expect(result.success).toBe(true);
      expect(result.scannedCount).toBe(4);
      expect(result.prunedCount).toBe(1);
      expect(result.skippedUnmergedCount).toBe(1);
      expect(result.skippedTooYoungCount).toBe(1);
      expect(result.unmergedBranchesSkipped).toContain("tombstone-old-unmerged");
      expect(result.reclaimedBytesEstimate).toBeGreaterThan(0);

      // Verify records remaining in IndexedDB
      const remaining = await getAllRecords(db);
      const remainingIds = remaining.map((r) => r.id);

      expect(remainingIds).not.toContain("tombstone-old-merged");
      expect(remainingIds).toContain("tombstone-old-unmerged");
      expect(remainingIds).toContain("tombstone-recent");
      expect(remainingIds).toContain("active-note-1");
    });

    it("respects stableVectorClock to prevent compaction of unmerged branches", async () => {
      const records: CrdtTombstoneRecord[] = [
        {
          id: "tombstone-merged-clock",
          deleted: true,
          deletedAt: now - thirtyOneDaysMs,
          isMerged: true,
          vectorClock: { nodeA: 2, nodeB: 3 },
        },
        {
          id: "tombstone-unmerged-clock",
          deleted: true,
          deletedAt: now - thirtyOneDaysMs,
          isMerged: true, // Marked true locally, but clock exceeds stable vector
          vectorClock: { nodeA: 5, nodeB: 3 },
        },
      ];

      await populateRecords(db, records);

      const stableVectorClock = { nodeA: 2, nodeB: 3 };

      const result = await compactTombstones(db, DEFAULT_TOMBSTONE_MAX_AGE_MS, {
        currentTime: now,
        stableVectorClock,
        stores: ["crdt_tombstones"],
      });

      expect(result.prunedCount).toBe(1);
      expect(result.skippedUnmergedCount).toBe(1);
      expect(result.unmergedBranchesSkipped).toContain("tombstone-unmerged-clock");

      const remaining = await getAllRecords(db);
      expect(remaining.map((r) => r.id)).toEqual(["tombstone-unmerged-clock"]);
    });

    it("performs dry run without deleting records when dryRun is true", async () => {
      const record: CrdtTombstoneRecord = {
        id: "tombstone-dry-run",
        deleted: true,
        deletedAt: now - thirtyOneDaysMs,
        isMerged: true,
      };

      await populateRecords(db, [record]);

      const result = await compactTombstones(db, DEFAULT_TOMBSTONE_MAX_AGE_MS, {
        currentTime: now,
        dryRun: true,
        stores: ["crdt_tombstones"],
      });

      expect(result.prunedCount).toBe(1);

      // In dry run mode, record is NOT deleted from DB
      const remaining = await getAllRecords(db);
      expect(remaining.map((r) => r.id)).toContain("tombstone-dry-run");
    });
  });

  describe("Tombstone Compactor Background Worker", () => {
    it("initializes and executes manual compaction", async () => {
      const worker = createTombstoneCompactorWorker(() => db, 60000, DEFAULT_TOMBSTONE_MAX_AGE_MS, {
        currentTime: now,
        stores: ["crdt_tombstones"],
      });

      expect(worker.isRunning()).toBe(false);
      worker.start();
      expect(worker.isRunning()).toBe(true);

      const result = await worker.compactNow();
      expect(result.success).toBe(true);

      worker.stop();
      expect(worker.isRunning()).toBe(false);
    });
  });
});
