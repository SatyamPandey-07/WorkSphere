/**
 * IndexedDB persistence for federated venue model weights (#1022).
 * Raw telemetry never leaves the device — only local weight blobs are stored.
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { WEIGHT_DB_NAME, WEIGHT_KEY, WEIGHT_STORE } from "./types";
import type { PrivacyLedgerState } from "./privacyAccountant";

export type WeightBlob = {
  weights: Float32Array;
  bias: number;
  updatedAt: number;
};

interface FederatedWeightDB extends DBSchema {
  modelWeights: {
    key: string;
    value: {
      weights: number[];
      bias: number;
      updatedAt: number;
    };
  };
  /**
   * Privacy ledger (#3359). A separate store on purpose: purgeStaleWeights
   * must never reset the spent privacy budget.
   */
  privacyLedger: {
    key: string;
    value: TrainerPrivacyState;
  };
}

/** Persisted DP state: spent budget + current adaptive clip bound. */
export type TrainerPrivacyState = {
  ledger: PrivacyLedgerState;
  clipNorm: number;
  updatedAt: number;
};

const LEDGER_STORE = "privacyLedger";
const LEDGER_KEY = "ledger";

let dbPromise: Promise<IDBPDatabase<FederatedWeightDB>> | null = null;

export async function getWeightDb(): Promise<IDBPDatabase<FederatedWeightDB>> {
  if (!dbPromise) {
    dbPromise = openDB<FederatedWeightDB>(WEIGHT_DB_NAME, 2, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(WEIGHT_STORE)) {
          db.createObjectStore(WEIGHT_STORE);
        }
        if (!db.objectStoreNames.contains(LEDGER_STORE)) {
          db.createObjectStore(LEDGER_STORE);
        }
      },
    });
  }
  return dbPromise;
}

export async function saveWeights(blob: WeightBlob): Promise<void> {
  const db = await getWeightDb();
  await db.put(
    WEIGHT_STORE,
    {
      weights: Array.from(blob.weights),
      bias: blob.bias,
      updatedAt: blob.updatedAt,
    },
    WEIGHT_KEY,
  );
}

export async function loadWeights(): Promise<WeightBlob | null> {
  const db = await getWeightDb();
  const row = await db.get(WEIGHT_STORE, WEIGHT_KEY);
  if (!row) return null;
  return {
    weights: new Float32Array(row.weights),
    bias: row.bias,
    updatedAt: row.updatedAt,
  };
}

export async function savePrivacyState(state: TrainerPrivacyState): Promise<void> {
  const db = await getWeightDb();
  await db.put(LEDGER_STORE, state, LEDGER_KEY);
}

export async function loadPrivacyState(): Promise<TrainerPrivacyState | null> {
  const db = await getWeightDb();
  return (await db.get(LEDGER_STORE, LEDGER_KEY)) ?? null;
}

export const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

export async function purgeStaleWeights(
  maxAgeMs: number = THIRTY_DAYS,
): Promise<{ deletedCount: number; remainingCount: number }> {
  try {
    const db = await getWeightDb();
    const tx = db.transaction(WEIGHT_STORE, "readwrite");
    const store = tx.objectStore(WEIGHT_STORE);

    let deletedCount = 0;
    let remainingCount = 0;
    const now = Date.now();

    let cursor = await store.openCursor();
    while (cursor) {
      const entry = cursor.value;
      if (now - entry.updatedAt > maxAgeMs) {
        await cursor.delete();
        deletedCount++;
      } else {
        remainingCount++;
      }
      cursor = await cursor.continue();
    }

    await tx.done;
    return { deletedCount, remainingCount };
  } catch (error) {
    console.error("[Federated] Failed to purge stale weights:", error);
    return { deletedCount: 0, remainingCount: 0 };
  }
}

/** Test helper — clears the module-level DB promise. */
export function resetWeightDbCache(): void {
  dbPromise = null;
}
