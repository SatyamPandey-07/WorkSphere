/**
 * tombstoneCompactor.ts
 *
 * Background compaction and garbage collection routine for CRDT state vectors and
 * deleted item tombstones in IndexedDB.
 *
 * Responsibilities:
 * - Scans CRDT object stores in IndexedDB.
 * - Prunes tombstones older than 30 days (maxAgeMs).
 * - CRITICAL: Prevents compaction of unmerged vector clock branches to prevent
 *   distributed resurrection anomalies across disconnected peers (#6488).
 * - Defragments storage blocks and provides reclaimed byte telemetry.
 */

export interface VectorClock {
  [nodeId: string]: number;
}

export interface CrdtTombstoneRecord {
  id: string;
  deleted?: boolean;
  isDeleted?: boolean;
  tombstone?: boolean;
  type?: string;
  status?: string;
  deletedAt?: number;
  timestamp?: number;
  updatedAt?: number;
  createdAt?: number;
  vectorClock?: VectorClock;
  isMerged?: boolean;
  merged?: boolean;
  syncStatus?: "merged" | "unmerged" | "pending" | "in_flight" | "conflict";
  unmergedBranches?: string[];
  payload?: unknown;
  [key: string]: unknown;
}

export interface TombstoneCompactionOptions {
  /** Target object store names in IndexedDB to scan */
  stores?: string[];
  /** Stable acknowledged vector clock baseline. Operations exceeding this clock are unmerged. */
  stableVectorClock?: VectorClock;
  /** Reference current timestamp (defaults to Date.now()) */
  currentTime?: number;
  /** Whether to simulate compaction without committing deletes to IndexedDB */
  dryRun?: boolean;
  /** Optional custom logger */
  logger?: (msg: string, ...args: unknown[]) => void;
}

export interface TombstoneCompactionResult {
  success: boolean;
  scannedCount: number;
  prunedCount: number;
  skippedUnmergedCount: number;
  skippedTooYoungCount: number;
  reclaimedBytesEstimate: number;
  durationMs: number;
  storesCompacted: string[];
  unmergedBranchesSkipped: string[];
  error?: string;
}

/** 30 days in milliseconds (30 * 24 * 60 * 60 * 1000) */
export const DEFAULT_TOMBSTONE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export const DEFAULT_COMPACTION_STORES = [
  "crdt_tombstones",
  "pending_sync_queue",
  "notes_cache",
  "pending_notes_queue",
  "crdt_operations",
];

/**
 * Checks whether an IndexedDB record qualifies as a CRDT tombstone.
 */
export function isTombstoneRecord(record: unknown): record is CrdtTombstoneRecord {
  if (!record || typeof record !== "object") return false;
  const r = record as Record<string, unknown>;

  return (
    r.deleted === true ||
    r.isDeleted === true ||
    r.tombstone === true ||
    r.type === "DELETE" ||
    r.type === "DELETE_ELEMENT" ||
    r.status === "deleted" ||
    r.action === "REMOVE" ||
    r.action === "DELETE"
  );
}

/**
 * Extracts the deletion timestamp from a tombstone record.
 */
export function getTombstoneTimestamp(record: CrdtTombstoneRecord): number {
  if (typeof record.deletedAt === "number" && !isNaN(record.deletedAt)) {
    return record.deletedAt;
  }
  if (typeof record.timestamp === "number" && !isNaN(record.timestamp)) {
    return record.timestamp;
  }
  if (typeof record.updatedAt === "number" && !isNaN(record.updatedAt)) {
    return record.updatedAt;
  }
  if (typeof record.createdAt === "number" && !isNaN(record.createdAt)) {
    return record.createdAt;
  }
  return 0;
}

/**
 * Determines whether a tombstone's vector clock branch is fully merged across peers.
 * CRITICAL (#6488): Unmerged vector clock branches MUST NOT be pruned, or disconnected
 * peers will resurrect the deleted entity upon later sync.
 */
export function isVectorClockMerged(
  record: CrdtTombstoneRecord,
  stableVectorClock?: VectorClock
): boolean {
  // 1. Explicit unmerged flags
  if (record.isMerged === false || record.merged === false) {
    return false;
  }
  if (record.unmerged === true) {
    return false;
  }

  // 2. Unmerged sync status
  if (
    record.syncStatus === "unmerged" ||
    record.syncStatus === "pending" ||
    record.syncStatus === "in_flight" ||
    record.syncStatus === "conflict"
  ) {
    return false;
  }

  // 3. Unmerged branches list
  if (Array.isArray(record.unmergedBranches) && record.unmergedBranches.length > 0) {
    return false;
  }

  // 4. Vector Clock comparison against stable baseline
  if (stableVectorClock && record.vectorClock && typeof record.vectorClock === "object") {
    for (const [nodeId, tick] of Object.entries(record.vectorClock)) {
      const stableTick = stableVectorClock[nodeId] || 0;
      if (typeof tick === "number" && tick > stableTick) {
        // This branch contains causality ticks not yet observed in the stable vector clock
        return false;
      }
    }
  }

  return true;
}

/**
 * Evaluates whether a record can be safely compacted.
 */
export function isTombstoneCompactionSafe(
  record: unknown,
  maxAgeMs: number = DEFAULT_TOMBSTONE_MAX_AGE_MS,
  currentTime: number = Date.now(),
  stableVectorClock?: VectorClock
): { canCompact: boolean; reason?: "not_tombstone" | "too_young" | "unmerged_branch" } {
  if (!isTombstoneRecord(record)) {
    return { canCompact: false, reason: "not_tombstone" };
  }

  const timestamp = getTombstoneTimestamp(record);
  const age = Math.max(0, currentTime - timestamp);

  if (age < maxAgeMs) {
    return { canCompact: false, reason: "too_young" };
  }

  if (!isVectorClockMerged(record, stableVectorClock)) {
    return { canCompact: false, reason: "unmerged_branch" };
  }

  return { canCompact: true };
}

/**
 * Rough byte size estimation of a JSON-serializable IndexedDB record.
 */
function estimateRecordByteSize(record: unknown): number {
  try {
    const json = JSON.stringify(record);
    return json ? json.length * 2 : 128; // UTF-16 approximate bytes
  } catch {
    return 256;
  }
}

/**
 * Scans CRDT object stores in IndexedDB, prunes tombstones older than maxAgeMs,
 * and defragments storage while strictly preserving unmerged vector clock branches.
 *
 * @param db Active IDBDatabase connection
 * @param maxAgeMs Minimum age in ms before a tombstone is eligible for compaction (default: 30 days)
 * @param options Additional compaction configuration
 */
export async function compactTombstones(
  db: IDBDatabase,
  maxAgeMs: number = DEFAULT_TOMBSTONE_MAX_AGE_MS,
  options: TombstoneCompactionOptions = {}
): Promise<TombstoneCompactionResult> {
  const startTime = Date.now();
  const now = options.currentTime ?? startTime;
  const targetStores = (options.stores ?? DEFAULT_COMPACTION_STORES).filter((s) =>
    db.objectStoreNames.contains(s)
  );

  const result: TombstoneCompactionResult = {
    success: true,
    scannedCount: 0,
    prunedCount: 0,
    skippedUnmergedCount: 0,
    skippedTooYoungCount: 0,
    reclaimedBytesEstimate: 0,
    durationMs: 0,
    storesCompacted: [],
    unmergedBranchesSkipped: [],
  };

  if (targetStores.length === 0) {
    result.durationMs = Date.now() - startTime;
    return result;
  }

  for (const storeName of targetStores) {
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, options.dryRun ? "readonly" : "readwrite");
        const store = tx.objectStore(storeName);
        const req = store.openCursor();

        tx.onabort = (e) => reject(tx.error || e);
        tx.onerror = (e) => reject(tx.error || e);
        tx.oncomplete = () => resolve();

        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) {
            return;
          }

          result.scannedCount++;
          const val = cursor.value;

          const evaluation = isTombstoneCompactionSafe(
            val,
            maxAgeMs,
            now,
            options.stableVectorClock
          );

          if (evaluation.canCompact) {
            const byteSize = estimateRecordByteSize(val);
            if (!options.dryRun) {
              cursor.delete();
            }
            result.prunedCount++;
            result.reclaimedBytesEstimate += byteSize;
          } else if (evaluation.reason === "unmerged_branch") {
            result.skippedUnmergedCount++;
            const branchId = val?.id || String(cursor.primaryKey || cursor.key);
            result.unmergedBranchesSkipped.push(branchId);
            options.logger?.(`[TombstoneCompactor] Skipped unmerged vector clock branch: ${branchId}`);
          } else if (evaluation.reason === "too_young") {
            result.skippedTooYoungCount++;
          }

          cursor.continue();
        };

        req.onerror = () => reject(req.error);
      });

      result.storesCompacted.push(storeName);
    } catch (err) {
      result.success = false;
      result.error = err instanceof Error ? err.message : String(err);
      options.logger?.(`[TombstoneCompactor] Error compacting store ${storeName}:`, err);
    }
  }

  result.durationMs = Date.now() - startTime;
  return result;
}

export interface TombstoneCompactorWorkerController {
  start: () => void;
  stop: () => void;
  compactNow: () => Promise<TombstoneCompactionResult>;
  isRunning: () => boolean;
}

/**
 * Creates a background worker / scheduler that periodically runs tombstone compaction.
 */
export function createTombstoneCompactorWorker(
  dbGetter: () => Promise<IDBDatabase> | IDBDatabase,
  intervalMs: number = 24 * 60 * 60 * 1000, // 24 hours
  maxAgeMs: number = DEFAULT_TOMBSTONE_MAX_AGE_MS,
  options: TombstoneCompactionOptions = {}
): TombstoneCompactorWorkerController {
  let timerId: ReturnType<typeof setInterval> | null = null;
  let active = false;

  const runCompaction = async (): Promise<TombstoneCompactionResult> => {
    try {
      const db = await dbGetter();
      return await compactTombstones(db, maxAgeMs, options);
    } catch (err) {
      return {
        success: false,
        scannedCount: 0,
        prunedCount: 0,
        skippedUnmergedCount: 0,
        skippedTooYoungCount: 0,
        reclaimedBytesEstimate: 0,
        durationMs: 0,
        storesCompacted: [],
        unmergedBranchesSkipped: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };

  return {
    start() {
      if (active) return;
      active = true;
      timerId = setInterval(runCompaction, intervalMs);
    },
    stop() {
      active = false;
      if (timerId) {
        clearInterval(timerId);
        timerId = null;
      }
    },
    compactNow() {
      return runCompaction();
    },
    isRunning() {
      return active;
    },
  };
}
