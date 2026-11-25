/**
 * src/lib/admin/partitionExport/types.ts
 *
 * Types for snapshot-consistent resumable partition exports with verifiable manifests (#10168).
 */

export type ExportJobStatus =
  | "QUEUED"
  | "RUNNING"
  | "PAUSED"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "EXPIRED";

export type ExportTableType = "telemetry" | "push" | "audit";

export interface ResumeCursor {
  lastId: string;
  lastTimestamp: string;
  batchIndex: number;
}

export interface ExportManifest {
  exportId: string;
  adminId: string;
  tableType: ExportTableType;
  tableName: string;
  timeRange: {
    start: string;
    end: string;
    year: number;
    month: number;
  };
  appliedFilters: {
    actorId?: string | null;
    actionType?: string | null;
  };
  snapshotId: string;
  snapshotTimestamp: string;
  schemaVersion: string;
  createdAt: number;
  expiresAt: number;
  status: ExportJobStatus;
  expectedRowCount?: number;
  completedRowCount: number;
  lastResumeCursor?: ResumeCursor;
  chunkDigests: string[];
  finalContentDigest: string;
}

export interface ExportJobRecord {
  id: string;
  adminId: string;
  tableType: ExportTableType;
  tableName: string;
  status: ExportJobStatus;
  snapshotId: string;
  snapshotTimestamp: string;
  schemaVersion: string;
  createdAt: number;
  expiresAt: number;
  expectedRowCount: number;
  completedRowCount: number;
  lastResumeCursor?: ResumeCursor;
  timeRange: {
    start: string;
    end: string;
    year: number;
    month: number;
  };
  appliedFilters: {
    actorId?: string | null;
    actionType?: string | null;
  };
  chunkDigests: string[];
  finalContentDigest?: string;
}

export interface CreateExportJobParams {
  adminId: string;
  tableType: ExportTableType;
  tableName: string;
  startIso: string;
  endIso: string;
  year: number;
  month: number;
  actorId?: string | null;
  actionType?: string | null;
  expectedRowCount?: number;
}
