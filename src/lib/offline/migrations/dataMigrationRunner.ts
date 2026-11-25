/**
 * src/lib/offline/migrations/dataMigrationRunner.ts
 *
 * Resumable, cursor-backed IndexedDB data migration executor (#10169).
 * Processes records in bounded batches outside `onupgradeneeded` so long-running
 * migrations remain crash-safe and checkpoint progress after each committed batch.
 */

import { adaptRecordForStore } from "./payloadAdapters";
import {
  DataMigrationExecutionContext,
  DataMigrationStepResult,
  MigrationError,
} from "./types";

function classifyTransactionError(
  err: unknown,
  dbName: string,
  storeName: string,
): MigrationError {
  if (err instanceof MigrationError) return err;
  const domErr = err as { name?: string; message?: string } | null;
  const name = domErr?.name ?? "";
  const message = domErr?.message ?? String(err || "Transaction failed");

  if (name === "QuotaExceededError" || /quota/i.test(message)) {
    return new MigrationError(
      "QUOTA_EXCEEDED",
      dbName,
      `Storage quota exceeded while migrating store '${storeName}': ${message}`,
      { recoverable: true, cause: err },
    );
  }
  if (name === "AbortError" || /abort/i.test(message)) {
    return new MigrationError(
      "TRANSACTION_ABORTED",
      dbName,
      `Migration transaction aborted on store '${storeName}': ${message}`,
      { recoverable: true, cause: err },
    );
  }
  return new MigrationError(
    "UPGRADE_FAILED",
    dbName,
    `Data migration failed on store '${storeName}': ${message}`,
    { recoverable: false, cause: err },
  );
}

/**
 * Encodes composite `(storeIndex, key)` into a deterministic string resume cursor
 * so multi-store data migrations can resume strictly after the last committed item.
 */
export function parseCompositeResumeCursor(
  cursor: string | number | null,
): { storeIdx: number; key: string | number | null } {
  if (typeof cursor === "string" && cursor.startsWith("s:")) {
    const firstColon = cursor.indexOf(":");
    const secondColon = cursor.indexOf(":", firstColon + 1);
    if (secondColon !== -1) {
      const storeIdx = Number(cursor.slice(firstColon + 1, secondColon));
      const rawKey = cursor.slice(secondColon + 1);
      if (Number.isInteger(storeIdx) && storeIdx >= 0) {
        if (rawKey.startsWith("n:")) {
          const parsedNum = Number(rawKey.slice(2));
          return {
            storeIdx,
            key: Number.isFinite(parsedNum) ? parsedNum : null,
          };
        }
        if (rawKey.startsWith("s:")) {
          return { storeIdx, key: rawKey.slice(2) };
        }
      }
    }
  }
  return { storeIdx: 0, key: null };
}

export function formatCompositeResumeCursor(
  storeIdx: number,
  key: IDBValidKey,
): string {
  if (typeof key === "number") {
    return `s:${storeIdx}:n:${key}`;
  }
  return `s:${storeIdx}:s:${String(key)}`;
}

/**
 * Runs an idempotent, batched, checkpointed data migration across one or more
 * object stores, preserving valid records and reporting malformed ones.
 */
export async function runResumableStoreDataMigration(
  ctx: DataMigrationExecutionContext,
  storeNames: string[],
  transformRecord?: (
    storeName: string,
    record: Record<string, unknown>,
  ) => Record<string, unknown>,
): Promise<DataMigrationStepResult> {
  const batchSize = Math.max(1, ctx.batchSize || 50);
  const resumeState = parseCompositeResumeCursor(ctx.resumeCursor);

  let processedCount = 0;
  let updatedCount = 0;
  let malformedCount = 0;

  for (
    let storeIdx = resumeState.storeIdx;
    storeIdx < storeNames.length;
    storeIdx++
  ) {
    const storeName = storeNames[storeIdx];
    if (!ctx.db.objectStoreNames.contains(storeName)) {
      continue;
    }

    let lastKey: string | number | null =
      storeIdx === resumeState.storeIdx ? resumeState.key : null;

    while (true) {
      if (ctx.signal?.aborted) {
        throw new MigrationError(
          "TRANSACTION_ABORTED",
          ctx.dbName,
          `Data migration aborted before processing store '${storeName}'`,
          { recoverable: true },
        );
      }

      const batchResult = await processStoreBatch(
        ctx,
        storeName,
        lastKey,
        batchSize,
        transformRecord,
      );

      processedCount += batchResult.batchProcessed;
      updatedCount += batchResult.batchUpdated;
      malformedCount += batchResult.batchMalformed;

      if (batchResult.lastSeenKey !== null) {
        lastKey = batchResult.lastSeenKey;
        const checkpointCursor = formatCompositeResumeCursor(
          storeIdx,
          batchResult.lastSeenKey,
        );
        await ctx.saveCheckpoint(checkpointCursor, batchResult.batchProcessed);
      }

      if (!batchResult.hasMore) {
        break;
      }
    }
  }

  return { processedCount, updatedCount, malformedCount };
}

async function processStoreBatch(
  ctx: DataMigrationExecutionContext,
  storeName: string,
  afterKey: string | number | null,
  batchSize: number,
  transformRecord?: (
    storeName: string,
    record: Record<string, unknown>,
  ) => Record<string, unknown>,
): Promise<{
  batchProcessed: number;
  batchUpdated: number;
  batchMalformed: number;
  lastSeenKey: string | number | null;
  hasMore: boolean;
}> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finishReject = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(classifyTransactionError(err, ctx.dbName, storeName));
    };

    let tx: IDBTransaction;
    try {
      tx = ctx.db.transaction([storeName], "readwrite");
    } catch (err) {
      finishReject(err);
      return;
    }

    let batchProcessed = 0;
    let batchUpdated = 0;
    let batchMalformed = 0;
    let lastSeenKey: string | number | null = null;
    let hasMore = false;

    tx.oncomplete = () => {
      if (settled) return;
      settled = true;
      resolve({
        batchProcessed,
        batchUpdated,
        batchMalformed,
        lastSeenKey,
        hasMore,
      });
    };

    tx.onabort = () => {
      finishReject(tx.error || new DOMException("Transaction aborted", "AbortError"));
    };

    tx.onerror = () => {
      finishReject(tx.error || new Error("Transaction error"));
    };

    try {
      const store = tx.objectStore(storeName);
      const range =
        afterKey !== null && typeof IDBKeyRange !== "undefined"
          ? IDBKeyRange.lowerBound(afterKey, true)
          : undefined;

      const cursorReq = store.openCursor(range, "next");
      cursorReq.onerror = () => {
        finishReject(cursorReq.error || new Error("Cursor iteration error"));
      };

      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) {
          hasMore = false;
          return;
        }

        if (ctx.signal?.aborted) {
          try {
            tx.abort();
          } catch {
            // ignore
          }
          return;
        }

        if (batchProcessed >= batchSize) {
          hasMore = true;
          return;
        }

        const key = cursor.primaryKey;
        if (typeof key === "string" || typeof key === "number") {
          lastSeenKey = key;
        }
        batchProcessed++;

        const adapted = adaptRecordForStore(storeName, cursor.value);
        if (!adapted.valid) {
          batchMalformed++;
          ctx.reportMalformedRecord(
            storeName,
            key,
            adapted.reason || "Malformed legacy record",
          );
        } else {
          const nextRecord = transformRecord
            ? transformRecord(storeName, adapted.record)
            : adapted.record;
          const needsWrite =
            adapted.changed ||
            (transformRecord !== undefined &&
              JSON.stringify(nextRecord) !== JSON.stringify(cursor.value));

          if (needsWrite) {
            try {
              const updateReq = cursor.update(nextRecord);
              updateReq.onerror = () => {
                finishReject(
                  updateReq.error || new Error("Failed to update record"),
                );
              };
              batchUpdated++;
            } catch (err) {
              finishReject(err);
              return;
            }
          }
        }

        cursor.continue();
      };
    } catch (err) {
      finishReject(err);
    }
  });
}
