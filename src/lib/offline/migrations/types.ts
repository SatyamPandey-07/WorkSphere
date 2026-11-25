/**
 * src/lib/offline/migrations/types.ts
 *
 * Shared types for WorkSphere's crash-safe, multi-context IndexedDB schema
 * and data migration protocol (#10169).
 */

export type MigrationContextKind =
  | "page"
  | "service-worker"
  | "worker"
  | "unknown";

export type MigrationErrorCode =
  | "BLOCKED_UPGRADE"
  | "QUOTA_EXCEEDED"
  | "TRANSACTION_ABORTED"
  | "VERSION_DOWNGRADE"
  | "MALFORMED_RECORD"
  | "SCHEMA_VALIDATION_FAILED"
  | "UPGRADE_FAILED"
  | "INDEXEDDB_UNAVAILABLE"
  | "TIMEOUT"
  | "STALE_SCHEMA_CONTEXT"
  | "UNKNOWN";

export type MigrationPhase =
  | "IDLE"
  | "COORDINATING"
  | "STRUCTURAL"
  | "VALIDATING"
  | "DATA_MIGRATION"
  | "COMPLETED"
  | "FAILED"
  | "BLOCKED";

export interface IndexSchemaExpectation {
  name: string;
  keyPath: string | string[];
  unique?: boolean;
  multiEntry?: boolean;
}

export interface StoreSchemaExpectation {
  name: string;
  keyPath?: string | string[] | null;
  autoIncrement?: boolean;
  indexes?: IndexSchemaExpectation[];
}

export interface StructuralMigrationStep {
  /** Unique deterministic identifier for this migration step. */
  id: string;
  /** Target schema version at which this structural step runs. */
  version: number;
  /** Human-readable description for diagnostics. */
  description: string;
  /**
   * Idempotent structural migration callback executed inside IndexedDB's
   * `onupgradeneeded` versionchange transaction.
   */
  upgrade: (
    db: IDBDatabase,
    transaction: IDBTransaction | null,
    oldVersion: number,
    newVersion: number,
  ) => void;
}

export interface DataMigrationStepResult {
  processedCount: number;
  updatedCount: number;
  malformedCount: number;
}

export interface DataMigrationExecutionContext {
  db: IDBDatabase;
  dbName: string;
  fromVersion: number;
  toVersion: number;
  resumeCursor: string | number | null;
  processedCount: number;
  batchSize: number;
  saveCheckpoint: (
    cursor: string | number | null,
    processedDelta?: number,
  ) => Promise<void>;
  reportMalformedRecord: (
    storeName: string,
    recordKey: unknown,
    reason: string,
  ) => void;
  signal?: AbortSignal;
}

export interface DataMigrationStep {
  /** Unique deterministic identifier for this data migration step. */
  id: string;
  /** Schema version after which this data migration step is eligible to run. */
  version: number;
  /** Human-readable description for diagnostics. */
  description: string;
  /** Stores read/updated by this data migration step. */
  storeNames: string[];
  /** Number of records processed per resumable transaction batch. */
  batchSize?: number;
  /**
   * Idempotent, resumable data migration executed outside the structural
   * `onupgradeneeded` transaction so large migrations can checkpoint progress.
   */
  migrate: (
    ctx: DataMigrationExecutionContext,
  ) => Promise<DataMigrationStepResult>;
}

export interface DatabaseMigrationDefinition {
  dbName: string;
  currentVersion: number;
  requiredStores: StoreSchemaExpectation[];
  structuralMigrations: StructuralMigrationStep[];
  dataMigrations: DataMigrationStep[];
}

export interface MalformedRecordSummary {
  storeName: string;
  keyHash: string;
  reason: string;
  detectedAt: number;
}

export interface MigrationErrorSummary {
  code: MigrationErrorCode;
  message: string;
  recoverable: boolean;
  timestamp: number;
}

export interface MigrationCheckpoint {
  dbName: string;
  targetVersion: number;
  appliedVersion: number;
  lastKnownValidVersion: number;
  phase: MigrationPhase;
  completedStructuralStepIds: string[];
  completedDataStepIds: string[];
  activeDataStepId: string | null;
  dataCursor: string | number | null;
  processedRecords: number;
  malformedRecordCount: number;
  malformedRecordSummaries: MalformedRecordSummary[];
  updatedAt: number;
  lastError?: MigrationErrorSummary;
}

export interface MigrationDiagnosticEvent {
  timestamp: number;
  dbName: string;
  context: MigrationContextKind;
  phase: MigrationPhase;
  message: string;
  version?: number;
  errorCode?: MigrationErrorCode;
}

export interface MigrationDiagnosticSnapshot {
  dbName: string;
  checkpoint: MigrationCheckpoint | null;
  activeConnectionCount: number;
  upgradeInProgress: boolean;
  recentEvents: MigrationDiagnosticEvent[];
}

export interface MigrationBroadcastMessage {
  type:
    | "UPGRADE_REQUESTED"
    | "CLOSE_CONNECTION"
    | "CONNECTION_CLOSED"
    | "UPGRADE_BLOCKED"
    | "UPGRADE_COMPLETED"
    | "UPGRADE_FAILED";
  dbName: string;
  targetVersion: number;
  senderId: string;
  appliedVersion?: number;
  errorCode?: MigrationErrorCode;
  timestamp: number;
}

export class MigrationError extends Error {
  readonly code: MigrationErrorCode;
  readonly dbName: string;
  readonly recoverable: boolean;
  readonly cause?: unknown;

  constructor(
    code: MigrationErrorCode,
    dbName: string,
    message: string,
    options: { recoverable?: boolean; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "MigrationError";
    this.code = code;
    this.dbName = dbName;
    this.recoverable = options.recoverable ?? false;
    this.cause = options.cause;
  }
}

export interface CoordinateOpenOptions {
  context?: MigrationContextKind;
  contextId?: string;
  targetVersion?: number;
  timeoutMs?: number;
  blockedTimeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
  onVersionChange?: (event: IDBVersionChangeEvent) => void;
  onBlocked?: () => void;
  skipDataMigrations?: boolean;
}
