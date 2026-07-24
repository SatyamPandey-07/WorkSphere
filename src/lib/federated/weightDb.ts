/**
 * IndexedDB persistence for federated venue model weights (#1022).
 * Raw telemetry never leaves the device — only local weight blobs are stored.
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  WEIGHT_DB_NAME,
  WEIGHT_KEY,
  WEIGHT_STORE,
} from "./types";

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
}

let dbPromise: Promise<IDBPDatabase<FederatedWeightDB>> | null = null;

export async function getWeightDb(): Promise<IDBPDatabase<FederatedWeightDB>> {
  if (!dbPromise) {
    dbPromise = openDB<FederatedWeightDB>(WEIGHT_DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(WEIGHT_STORE)) {
          db.createObjectStore(WEIGHT_STORE);
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

/** Test helper — clears the module-level DB promise. */
export function resetWeightDbCache(): void {
  dbPromise = null;
}
