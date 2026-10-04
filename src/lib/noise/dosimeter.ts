/**
 * NIOSH Daily Noise Exposure Dosimetry Engine & Storage
 *
 * Implements NIOSH Recommended Exposure Limit (REL) standards:
 * - Criterion Level (L_c): 85 dBA
 * - Exchange Rate (Q): 3 dB
 * - Criterion Duration (T_c): 8 hours (480 minutes / 28,800 seconds)
 *
 * Mathematical Formulations:
 * 1. Allowable Duration:
 *    T(L) = 8 / (2 ^ ((L - 85) / 3)) [hours]
 * 2. Dose Contribution:
 *    D_i = 100 * (C_i / T_i) [%]
 * 3. Total Daily Cumulative Dose:
 *    D = 100 * sum( C_i / T_i ) [%]
 * 4. 8-Hour Time-Weighted Average (TWA):
 *    TWA = 85 + (3 / log10(2)) * log10(D / 100) = 85 + 9.965784 * log10(D / 100) [dBA]
 * 5. Equivalent Continuous Sound Level (Leq):
 *    Leq = 10 * log10( (1 / sum(t_i)) * sum( t_i * 10^(L_i / 10) ) ) [dBA]
 *
 * Thresholds:
 * - Safe: < 80%
 * - Warning: 80% - 99.9%
 * - Danger (Exceeded): >= 100%
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export const NIOSH_CRITERION_DB = 85;
export const NIOSH_EXCHANGE_RATE = 3;
export const NIOSH_CRITERION_HOURS = 8;
export const NIOSH_CRITERION_SECONDS = 8 * 3600; // 28,800 seconds

export const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
export const DOSE_WARNING_THRESHOLD = 80;
export const DOSE_DANGER_THRESHOLD = 100;

export type NoiseDoseStatus = "safe" | "warning" | "danger";

export interface ExposureSegment {
  decibels: number;
  durationSeconds: number;
  timestamp?: number;
}

export interface ExposureRecord {
  id?: number;
  timestamp: number;
  decibels: number;
  durationSeconds: number;
  doseContribution: number;
}

export interface DailyNoiseExposureSummary {
  dosePercentage: number;
  totalExposureSeconds: number;
  totalExposureHours: number;
  allowableHours: number;
  leq: number;
  twa: number;
  status: NoiseDoseStatus;
  isExceeded: boolean;
  isWarning: boolean;
  sampleCount: number;
}

export interface NioshDoseResult {
  dosePercentage: number;
  exposureHours: number;
  allowableHours: number;
  allowableMinutes: number;
  twa: number;
  status: NoiseDoseStatus;
  isExceeded: boolean;
  isWarning: boolean;
}

/**
 * Calculates allowable exposure duration in hours for a given sound level under NIOSH standards.
 * T(L) = 8 / (2 ^ ((L - 85) / 3))
 */
export function calculateNioshAllowableHours(decibelLevel: number): number {
  if (!Number.isFinite(decibelLevel)) return 0;
  return NIOSH_CRITERION_HOURS / Math.pow(2, (decibelLevel - NIOSH_CRITERION_DB) / NIOSH_EXCHANGE_RATE);
}

/**
 * Calculates allowable exposure duration in minutes for a given sound level under NIOSH standards.
 */
export function calculateNioshAllowableMinutes(decibelLevel: number): number {
  return calculateNioshAllowableHours(decibelLevel) * 60;
}

/**
 * Calculates allowable exposure duration in seconds for a given sound level under NIOSH standards.
 */
export function calculateNioshAllowableSeconds(decibelLevel: number): number {
  return calculateNioshAllowableHours(decibelLevel) * 3600;
}

/**
 * Determines the risk status based on the dose percentage.
 * - safe: < 80%
 * - warning: 80% to < 100%
 * - danger: >= 100%
 */
export function getDoseStatus(dosePercentage: number): NoiseDoseStatus {
  if (dosePercentage >= DOSE_DANGER_THRESHOLD) return "danger";
  if (dosePercentage >= DOSE_WARNING_THRESHOLD) return "warning";
  return "safe";
}

/**
 * Calculates single-event or continuous NIOSH noise dose percentage for a given duration in minutes.
 * Formula: D = (C / T) * 100 %
 */
export function calculateNioshDose(
  decibelLevel: number,
  durationMinutes: number,
): NioshDoseResult {
  const exposureHours = Math.max(0, durationMinutes) / 60;
  const allowableHours = calculateNioshAllowableHours(decibelLevel);
  const allowableMinutes = allowableHours * 60;

  const rawDose = (exposureHours / allowableHours) * 100;
  const dosePercentage =
    rawDose > 0 && rawDose < 0.001
      ? Math.round(rawDose * 10000) / 10000
      : Math.round(rawDose * 100) / 100;

  let twa = 0;
  if (rawDose > 0) {
    const factor = NIOSH_EXCHANGE_RATE / Math.log10(2);
    twa = factor * Math.log10(rawDose / 100) + NIOSH_CRITERION_DB;
  }
  const timeWeightedAverage = Math.max(0, Math.round(twa * 10) / 10);
  const status = getDoseStatus(dosePercentage);

  return {
    dosePercentage,
    exposureHours: Math.round(exposureHours * 1000) / 1000,
    allowableHours: Math.round(allowableHours * 100) / 100,
    allowableMinutes: Math.round(allowableMinutes * 10) / 10,
    twa: timeWeightedAverage,
    status,
    isExceeded: dosePercentage >= DOSE_DANGER_THRESHOLD,
    isWarning: dosePercentage >= DOSE_WARNING_THRESHOLD && dosePercentage < DOSE_DANGER_THRESHOLD,
  };
}

/**
 * Calculates single-event NIOSH noise dose percentage directly from duration in seconds.
 */
export function calculateNioshDoseFromSeconds(
  decibelLevel: number,
  durationSeconds: number,
): number {
  if (!Number.isFinite(decibelLevel)) {
    return durationSeconds > 0 ? 100 : 0;
  }
  const allowableSeconds = calculateNioshAllowableSeconds(decibelLevel);
  if (allowableSeconds <= 0 || !Number.isFinite(allowableSeconds)) return 0;
  return (Math.max(0, durationSeconds) / allowableSeconds) * 100;
}

/**
 * Calculates cumulative dose %, Leq, and TWA across multiple exposure segments.
 * D = 100 * sum( C_i / T_i )
 */
export function calculateCumulativeNioshDose(
  segments: ExposureSegment[],
): DailyNoiseExposureSummary {
  let totalDose = 0;
  let totalDurationSeconds = 0;
  let totalEnergy = 0;

  for (const seg of segments) {
    const durSec = Math.max(0, seg.durationSeconds);
    if (durSec <= 0 || !Number.isFinite(seg.decibels)) continue;

    totalDurationSeconds += durSec;
    const doseContr = calculateNioshDoseFromSeconds(seg.decibels, durSec);
    totalDose += doseContr;
    totalEnergy += durSec * Math.pow(10, seg.decibels / 10);
  }

  const dosePercentage = Math.round(totalDose * 100) / 100;
  const totalExposureHours = Math.round((totalDurationSeconds / 3600) * 100) / 100;

  let leq = 30.0;
  if (totalDurationSeconds > 0 && totalEnergy > 0) {
    leq = Math.round(10 * Math.log10(totalEnergy / totalDurationSeconds) * 10) / 10;
  }

  let twa = 0;
  if (totalDose > 0) {
    const factor = NIOSH_EXCHANGE_RATE / Math.log10(2);
    twa = factor * Math.log10(totalDose / 100) + NIOSH_CRITERION_DB;
  }
  const roundedTwa = Math.max(0, Math.round(twa * 10) / 10);
  const status = getDoseStatus(dosePercentage);
  const allowableHours = calculateNioshAllowableHours(leq);

  return {
    dosePercentage,
    totalExposureSeconds: totalDurationSeconds,
    totalExposureHours,
    allowableHours: Math.round(allowableHours * 100) / 100,
    leq,
    twa: roundedTwa,
    status,
    isExceeded: dosePercentage >= DOSE_DANGER_THRESHOLD,
    isWarning: dosePercentage >= DOSE_WARNING_THRESHOLD && dosePercentage < DOSE_DANGER_THRESHOLD,
    sampleCount: segments.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 24-Hour Rolling Reset IndexedDB Storage
// ─────────────────────────────────────────────────────────────────────────────

const DB_NAME = "worksphere-noise-dosimeter";
const STORE_NAME = "exposure_samples";
const DB_VERSION = 1;

interface DosimeterDB extends DBSchema {
  [STORE_NAME]: {
    key: number;
    value: ExposureRecord;
    indexes: { timestamp: number };
  };
}

let dbPromise: Promise<IDBPDatabase<DosimeterDB>> | null = null;
const memoryFallbackRecords: ExposureRecord[] = [];

function isIndexedDbAvailable(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

function getDosimeterDb(): Promise<IDBPDatabase<DosimeterDB>> {
  if (!dbPromise) {
    dbPromise = openDB<DosimeterDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex("timestamp", "timestamp");
      },
    });
  }
  return dbPromise;
}

/**
 * Purges exposure records older than 24 hours from the database or memory store.
 */
export async function pruneOldExposureRecords(cutoffTimestamp?: number): Promise<void> {
  const cutoff = cutoffTimestamp ?? Date.now() - ROLLING_WINDOW_MS;

  if (!isIndexedDbAvailable()) {
    const valid = memoryFallbackRecords.filter((r) => r.timestamp >= cutoff);
    memoryFallbackRecords.length = 0;
    memoryFallbackRecords.push(...valid);
    return;
  }

  try {
    const db = await getDosimeterDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const index = tx.store.index("timestamp");
    const oldKeys = await index.getAllKeys(IDBKeyRange.upperBound(cutoff, true));
    for (const key of oldKeys) {
      await tx.store.delete(key);
    }
    await tx.done;
  } catch (err) {
    console.warn("Failed to prune old dosimeter records from IndexedDB:", err);
  }
}

/**
 * Records a new noise exposure duration and decibel level into the 24-hour rolling store.
 */
export async function recordNoiseExposure(
  decibels: number,
  durationSeconds: number,
  timestamp?: number,
): Promise<DailyNoiseExposureSummary> {
  const now = timestamp ?? Date.now();
  const validSec = Math.max(0, durationSeconds);
  const doseContribution = calculateNioshDoseFromSeconds(decibels, validSec);

  const record: ExposureRecord = {
    timestamp: now,
    decibels,
    durationSeconds: validSec,
    doseContribution,
  };

  if (!isIndexedDbAvailable()) {
    memoryFallbackRecords.push(record);
    await pruneOldExposureRecords(now - ROLLING_WINDOW_MS);
    return getDailyNoiseExposure(now);
  }

  try {
    const db = await getDosimeterDb();
    await db.add(STORE_NAME, record);
    await pruneOldExposureRecords(now - ROLLING_WINDOW_MS);
  } catch (err) {
    console.warn("Failed to write to dosimeter IndexedDB, using memory fallback:", err);
    memoryFallbackRecords.push(record);
  }

  return getDailyNoiseExposure(now);
}

/**
 * Retrieves the cumulative daily noise exposure summary within the rolling 24-hour window.
 */
export async function getDailyNoiseExposure(
  currentTimestamp?: number,
): Promise<DailyNoiseExposureSummary> {
  const now = currentTimestamp ?? Date.now();
  const cutoff = now - ROLLING_WINDOW_MS;

  let records: ExposureRecord[] = [];

  if (!isIndexedDbAvailable()) {
    records = memoryFallbackRecords.filter((r) => r.timestamp >= cutoff);
  } else {
    try {
      const db = await getDosimeterDb();
      const tx = db.transaction(STORE_NAME, "readonly");
      const index = tx.store.index("timestamp");
      records = await index.getAll(IDBKeyRange.lowerBound(cutoff));
    } catch (err) {
      console.warn("Failed to read from dosimeter IndexedDB, falling back to memory:", err);
      records = memoryFallbackRecords.filter((r) => r.timestamp >= cutoff);
    }
  }

  const segments: ExposureSegment[] = records.map((r) => ({
    decibels: r.decibels,
    durationSeconds: r.durationSeconds,
    timestamp: r.timestamp,
  }));

  return calculateCumulativeNioshDose(segments);
}

/**
 * Completely resets the stored daily noise exposure records.
 */
export async function resetDailyNoiseExposure(): Promise<void> {
  memoryFallbackRecords.length = 0;

  if (!isIndexedDbAvailable()) return;

  try {
    const db = await getDosimeterDb();
    await db.clear(STORE_NAME);
  } catch (err) {
    console.warn("Failed to clear dosimeter IndexedDB:", err);
  }
}
