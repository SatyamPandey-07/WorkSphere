/**
 * src/lib/admin/partitionExport/exportJobService.ts
 *
 * Snapshot-consistent export job tracking, resumable cursor persistence,
 * chunk-level hashing, and verifiable manifest generation (#10168).
 */

import {
  CreateExportJobParams,
  ExportJobRecord,
  ExportManifest,
  ResumeCursor,
} from "./types";

const EXPORT_JOB_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const EXPORT_SCHEMA_VERSION = "1.0.0-snapshot";

const exportJobs = new Map<string, ExportJobRecord>();

function getCryptoHash(data: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require("crypto");
  return crypto.createHash("sha256").update(data).digest("hex");
}

function generateJobId(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require("crypto");
  if (crypto && typeof crypto.randomUUID === "function") {
    return `exp_${crypto.randomUUID()}`;
  }
  return `exp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Creates a new snapshot-consistent export job.
 */
export function createExportJob(
  params: CreateExportJobParams,
): ExportJobRecord {
  const id = generateJobId();
  const now = Date.now();
  const snapshotTimestamp = new Date(now).toISOString();
  const snapshotId = `snap_${now}_${id.substring(4, 12)}`;

  const job: ExportJobRecord = {
    id,
    adminId: params.adminId,
    tableType: params.tableType,
    tableName: params.tableName,
    status: "RUNNING",
    snapshotId,
    snapshotTimestamp,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    createdAt: now,
    expiresAt: now + EXPORT_JOB_TTL_MS,
    expectedRowCount: params.expectedRowCount ?? 0,
    completedRowCount: 0,
    timeRange: {
      start: params.startIso,
      end: params.endIso,
      year: params.year,
      month: params.month,
    },
    appliedFilters: {
      actorId: params.actorId,
      actionType: params.actionType,
    },
    chunkDigests: [],
  };

  exportJobs.set(id, job);
  return job;
}

/**
 * Retrieves an export job, enforcing administrator authorization when requested.
 */
export function getExportJob(
  jobId: string,
  adminId?: string,
): ExportJobRecord | null {
  const job = exportJobs.get(jobId);
  if (!job) return null;

  // Enforce job expiry
  if (Date.now() > job.expiresAt) {
    job.status = "EXPIRED";
    return job;
  }

  // Authorization check: only creating admin or maintainer can access
  if (adminId && job.adminId !== adminId && adminId !== "system_admin") {
    return null;
  }

  return job;
}

/**
 * Updates batch progress and persists the resume cursor after a chunk is processed.
 */
export function updateExportJobProgress(
  jobId: string,
  cursor: ResumeCursor,
  rowsInBatch: number,
  chunkDigest: string,
): void {
  const job = exportJobs.get(jobId);
  if (!job) return;

  job.lastResumeCursor = cursor;
  job.completedRowCount += rowsInBatch;
  job.chunkDigests.push(chunkDigest);
}

/**
 * Computes a deterministic SHA-256 digest for an export stream chunk.
 */
export function computeChunkDigest(chunk: string | Uint8Array): string {
  const text = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
  return getCryptoHash(text);
}

/**
 * Computes the final composite digest over all ordered chunk digests.
 */
export function computeFinalContentDigest(chunkDigests: string[]): string {
  if (chunkDigests.length === 0) {
    return getCryptoHash("empty_export");
  }
  return getCryptoHash(chunkDigests.join(":"));
}

/**
 * Finalizes an export job and constructs its verifiable manifest.
 */
export function finalizeExportManifest(
  jobId: string,
  finalRowCount?: number,
): ExportManifest | null {
  const job = exportJobs.get(jobId);
  if (!job) return null;

  if (finalRowCount !== undefined) {
    job.completedRowCount = finalRowCount;
  }

  job.status = "COMPLETED";
  job.finalContentDigest = computeFinalContentDigest(job.chunkDigests);

  const manifest: ExportManifest = {
    exportId: job.id,
    adminId: job.adminId,
    tableType: job.tableType,
    tableName: job.tableName,
    timeRange: job.timeRange,
    appliedFilters: job.appliedFilters,
    snapshotId: job.snapshotId,
    snapshotTimestamp: job.snapshotTimestamp,
    schemaVersion: job.schemaVersion,
    createdAt: job.createdAt,
    expiresAt: job.expiresAt,
    status: job.status,
    expectedRowCount: job.expectedRowCount,
    completedRowCount: job.completedRowCount,
    lastResumeCursor: job.lastResumeCursor,
    chunkDigests: [...job.chunkDigests],
    finalContentDigest: job.finalContentDigest,
  };

  return manifest;
}

/**
 * Cancels an in-progress export job.
 */
export function cancelExportJob(jobId: string, adminId: string): boolean {
  const job = exportJobs.get(jobId);
  if (!job) return false;
  if (job.adminId !== adminId && adminId !== "system_admin") return false;

  job.status = "CANCELLED";
  return true;
}

/**
 * Verifies that chunk digests or final artifact matches the recorded manifest digest.
 */
export function verifyExportIntegrity(
  manifest: ExportManifest,
  chunkDigests: string[],
): { valid: boolean; error?: string } {
  if (manifest.status !== "COMPLETED") {
    return {
      valid: false,
      error: `Export job is not completed (current status: ${manifest.status}).`,
    };
  }

  if (manifest.chunkDigests.length !== chunkDigests.length) {
    return {
      valid: false,
      error: `Chunk count mismatch: expected ${manifest.chunkDigests.length}, got ${chunkDigests.length}.`,
    };
  }

  for (let i = 0; i < chunkDigests.length; i++) {
    if (manifest.chunkDigests[i] !== chunkDigests[i]) {
      return {
        valid: false,
        error: `Chunk at index ${i} corrupted: expected digest ${manifest.chunkDigests[i]}, got ${chunkDigests[i]}.`,
      };
    }
  }

  const computedFinal = computeFinalContentDigest(chunkDigests);
  if (computedFinal !== manifest.finalContentDigest) {
    return {
      valid: false,
      error: "Final composite content digest mismatch.",
    };
  }

  return { valid: true };
}

/**
 * Clears in-memory jobs (used in tests).
 */
export function clearExportJobs(): void {
  exportJobs.clear();
}
