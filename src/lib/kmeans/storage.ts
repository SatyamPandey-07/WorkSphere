/**
 * HMAC-signed localStorage persistence for centroid matrices (#1127)
 */

import type { CentroidStoragePayload, ClusterCentroids } from "./types";
import {
  CENTROID_STORAGE_KEY,
  CENTROID_STORAGE_VERSION,
  HMAC_SALT,
  NUM_CLUSTERS,
} from "./types";
import { isValidVector } from "./mathUtils";

let cachedCryptoKey: CryptoKey | null = null;

async function getHmacKey(): Promise<CryptoKey> {
  if (cachedCryptoKey) return cachedCryptoKey;
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(HMAC_SALT),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  cachedCryptoKey = keyMaterial;
  return keyMaterial;
}

export async function computeHmac(
  payload: CentroidStoragePayload,
): Promise<string> {
  const key = await getHmacKey();
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(payload));
  const signature = await crypto.subtle.sign("HMAC", key, data);
  const bytes = new Uint8Array(signature);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyHmac(
  payload: CentroidStoragePayload,
  hmac: string,
): Promise<boolean> {
  try {
    const expected = await computeHmac(payload);
    if (expected.length !== hmac.length) return false;
    let result = 0;
    for (let i = 0; i < expected.length; i++) {
      result |= expected.charCodeAt(i) ^ hmac.charCodeAt(i);
    }
    return result === 0;
  } catch {
    return false;
  }
}

function validatePayload(payload: unknown): payload is CentroidStoragePayload {
  if (typeof payload !== "object" || payload === null) return false;
  const obj = payload as Record<string, unknown>;
  if (!Array.isArray(obj.centroids)) return false;
  if (typeof obj.k !== "number" || obj.k !== NUM_CLUSTERS) return false;
  if (typeof obj.version !== "number") return false;
  if (typeof obj.computedAt !== "number") return false;
  if (typeof obj.dataPoints !== "number") return false;
  for (const centroid of obj.centroids) {
    if (!isValidVector(centroid)) return false;
  }
  return true;
}

export async function loadCentroids(): Promise<ClusterCentroids | null> {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(CENTROID_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof parsed.hmac !== "string" ||
      typeof parsed.centroids !== "object" ||
      parsed.centroids === null
    ) {
      clearCentroids();
      return null;
    }
    const payload: CentroidStoragePayload = {
      centroids: parsed.centroids as CentroidStoragePayload["centroids"],
      k: parsed.k as number,
      version: parsed.version as number,
      computedAt: parsed.computedAt as number,
      dataPoints: parsed.dataPoints as number,
    };
    if (!validatePayload(payload)) {
      clearCentroids();
      return null;
    }
    if (payload.version < CENTROID_STORAGE_VERSION) {
      clearCentroids();
      return null;
    }
    const isValid = await verifyHmac(payload, parsed.hmac);
    if (!isValid) {
      console.warn(
        "[KMeans] Centroid HMAC verification failed — discarding cache",
      );
      clearCentroids();
      return null;
    }
    return { ...payload, hmac: parsed.hmac };
  } catch (err) {
    console.warn("[KMeans] Failed to load centroids from storage:", err);
    clearCentroids();
    return null;
  }
}

export async function saveCentroids(
  centroids: ClusterCentroids,
): Promise<boolean> {
  try {
    if (typeof localStorage === "undefined") return false;
    const payload: CentroidStoragePayload = {
      centroids: centroids.centroids,
      k: centroids.k,
      version: centroids.version,
      computedAt: centroids.computedAt,
      dataPoints: centroids.dataPoints,
    };
    const hmac = await computeHmac(payload);
    const envelope: ClusterCentroids = { ...payload, hmac };
    localStorage.setItem(CENTROID_STORAGE_KEY, JSON.stringify(envelope));
    return true;
  } catch (err) {
    console.warn("[KMeans] Failed to save centroids to storage:", err);
    return false;
  }
}

export function clearCentroids(): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(CENTROID_STORAGE_KEY);
    }
  } catch {
    // Silently ignore
  }
}
