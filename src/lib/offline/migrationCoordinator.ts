/**
 * src/lib/offline/migrationCoordinator.ts
 *
 * Crash-safe, multi-context IndexedDB schema migration coordinator across
 * browser tabs, application pages, Web Workers, and Service Workers (#10169).
 */

import { withWebLock } from "@/lib/webLock";
import {
  getMigrationRegistry,
  sortDataSteps,
  sortStructuralSteps,
  validateRequiredStores,
} from "./migrations/migrationRegistry";
import { sanitizeRecordKeyForLog } from "./migrations/payloadAdapters";
import {
  CoordinateOpenOptions,
  DatabaseMigrationDefinition,
  MalformedRecordSummary,
  MigrationBroadcastMessage,
  MigrationCheckpoint,
  MigrationContextKind,
  MigrationDiagnosticEvent,
  MigrationDiagnosticSnapshot,
  MigrationError,
  MigrationErrorCode,
  MigrationPhase,
} from "./migrations/types";

export const MIGRATION_BROADCAST_CHANNEL =
  "worksphere:idb-migration-coordination";
export const MIGRATION_STATE_DB_NAME = "WorkSphereMigrationStateDB";
export const MIGRATION_STATE_DB_VERSION = 1;
export const MIGRATION_STATE_STORE_NAME = "migration_checkpoints";
export const DEFAULT_MIGRATION_TIMEOUT_MS = 5000;
export const DEFAULT_BLOCKED_TIMEOUT_MS = 1500;
const MAX_DIAGNOSTIC_EVENTS = 100;
const MAX_MALFORMED_SUMMARIES = 50;

const CONTEXT_INSTANCE_ID = `ctx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// Track active connections & state per database in this execution context
const activeConnections = new Map<string, Set<IDBDatabase>>();
const staleConnections = new WeakSet<IDBDatabase>();
const upgradingDatabases = new Set<string>();
const checkpointMirror = new Map<string, MigrationCheckpoint>();
const diagnosticEvents: MigrationDiagnosticEvent[] = [];
const eventListeners = new Set<(event: MigrationDiagnosticEvent) => void>();

let coordinationChannel: BroadcastChannel | null = null;
let stateDbPromise: Promise<IDBDatabase | null> | null = null;

function detectContextKind(explicit?: MigrationContextKind): MigrationContextKind {
  if (explicit) return explicit;
  if (typeof window !== "undefined") return "page";
  if (
    typeof self !== "undefined" &&
    "clients" in (self as unknown as Record<string, unknown>)
  ) {
    return "service-worker";
  }
  if (typeof self !== "undefined") return "worker";
  return "unknown";
}

function recordDiagnosticEvent(event: MigrationDiagnosticEvent): void {
  diagnosticEvents.push(event);
  if (diagnosticEvents.length > MAX_DIAGNOSTIC_EVENTS) {
    diagnosticEvents.shift();
  }
  for (const listener of eventListeners) {
    try {
      listener(event);
    } catch {
      // Never allow listener errors to disrupt migrations
    }
  }
}

export function subscribeMigrationDiagnostics(
  listener: (event: MigrationDiagnosticEvent) => void,
): () => void {
  eventListeners.add(listener);
  return () => {
    eventListeners.delete(listener);
  };
}

function classifyError(
  err: unknown,
  dbName: string,
  fallbackCode: MigrationErrorCode = "UPGRADE_FAILED",
): MigrationError {
  if (err instanceof MigrationError) return err;

  const domErr = err as { name?: string; message?: string } | null;
  const name = domErr?.name ?? "";
  const message = domErr?.message ?? String(err || "Unknown migration error");

  if (name === "QuotaExceededError" || /quota/i.test(message)) {
    return new MigrationError("QUOTA_EXCEEDED", dbName, message, {
      recoverable: true,
      cause: err,
    });
  }
  if (name === "AbortError" || /abort/i.test(message)) {
    return new MigrationError("TRANSACTION_ABORTED", dbName, message, {
      recoverable: true,
      cause: err,
    });
  }
  if (
    name === "VersionError" ||
    /less than the existing version/i.test(message)
  ) {
    return new MigrationError("VERSION_DOWNGRADE", dbName, message, {
      recoverable: false,
      cause: err,
    });
  }
  if (name === "TimeoutError") {
    return new MigrationError("TIMEOUT", dbName, message, {
      recoverable: true,
      cause: err,
    });
  }
  return new MigrationError(fallbackCode, dbName, message, {
    recoverable: false,
    cause: err,
  });
}

function getCoordinationChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (!coordinationChannel) {
    try {
      coordinationChannel = new BroadcastChannel(MIGRATION_BROADCAST_CHANNEL);
      coordinationChannel.onmessage = (
        event: MessageEvent<MigrationBroadcastMessage>,
      ) => {
        handleCoordinationMessage(event.data);
      };
    } catch {
      coordinationChannel = null;
    }
  }
  return coordinationChannel;
}

function postCoordinationMessage(
  msg: Omit<MigrationBroadcastMessage, "senderId" | "timestamp">,
): void {
  const channel = getCoordinationChannel();
  if (!channel) return;
  try {
    channel.postMessage({
      ...msg,
      senderId: CONTEXT_INSTANCE_ID,
      timestamp: Date.now(),
    });
  } catch {
    // Ignore closed/restricted channel errors
  }
}

export function handleCoordinationMessage(msg: MigrationBroadcastMessage): void {
  if (!msg || !msg.dbName || msg.senderId === CONTEXT_INSTANCE_ID) return;

  if (msg.type === "UPGRADE_REQUESTED" || msg.type === "UPGRADE_BLOCKED") {
    upgradingDatabases.add(msg.dbName);
    closeDatabaseConnections(msg.dbName);
    recordDiagnosticEvent({
      timestamp: Date.now(),
      dbName: msg.dbName,
      context: detectContextKind(),
      phase: msg.type === "UPGRADE_BLOCKED" ? "BLOCKED" : "COORDINATING",
      version: msg.targetVersion,
      message: `Yielded local connections due to ${msg.type} from remote context`,
    });
    postCoordinationMessage({
      type: "CONNECTION_CLOSED",
      dbName: msg.dbName,
      targetVersion: msg.targetVersion,
    });
  } else if (
    msg.type === "UPGRADE_COMPLETED" ||
    msg.type === "UPGRADE_FAILED"
  ) {
    upgradingDatabases.delete(msg.dbName);
    recordDiagnosticEvent({
      timestamp: Date.now(),
      dbName: msg.dbName,
      context: detectContextKind(),
      phase: msg.type === "UPGRADE_COMPLETED" ? "COMPLETED" : "FAILED",
      version: msg.appliedVersion ?? msg.targetVersion,
      errorCode: msg.errorCode,
      message: `Remote context reported ${msg.type}`,
    });
  }
}

export function isUpgradeInProgress(dbName: string): boolean {
  return upgradingDatabases.has(dbName);
}

export function isConnectionValid(db: IDBDatabase | null | undefined): boolean {
  if (!db) return false;
  return !staleConnections.has(db);
}

/**
 * Prevents opening new transactions against an outdated or closed schema handle
 * after an upgrade has been requested.
 */
export function assertConnectionUsable(
  dbName: string,
  db: IDBDatabase | null | undefined,
): asserts db is IDBDatabase {
  if (upgradingDatabases.has(dbName)) {
    throw new MigrationError(
      "STALE_SCHEMA_CONTEXT",
      dbName,
      `Schema upgrade in progress for '${dbName}'; refusing transaction against outdated schema.`,
      { recoverable: true },
    );
  }
  if (!db || staleConnections.has(db)) {
    throw new MigrationError(
      "STALE_SCHEMA_CONTEXT",
      dbName,
      `Connection for '${dbName}' is closed or superseded by a newer schema version.`,
      { recoverable: true },
    );
  }
}

/**
 * Closes all open connections for `dbName` in the current context and marks them stale.
 */
export function closeDatabaseConnections(dbName: string): void {
  const set = activeConnections.get(dbName);
  if (set && set.size > 0) {
    for (const db of set) {
      staleConnections.add(db);
      try {
        db.close();
      } catch {
        // Ignore close errors
      }
    }
    set.clear();
  }
}

export function closeAllManagedConnections(): void {
  for (const dbName of activeConnections.keys()) {
    closeDatabaseConnections(dbName);
  }
}

function registerActiveConnection(dbName: string, db: IDBDatabase): void {
  let set = activeConnections.get(dbName);
  if (!set) {
    set = new Set();
    activeConnections.set(dbName, set);
  }
  set.add(db);
}

// ---------------------------------------------------------------------------
// Checkpoint Persistence ("WorkSphereMigrationStateDB")
// ---------------------------------------------------------------------------

async function openMigrationStateDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return null;
  if (stateDbPromise) return stateDbPromise;

  stateDbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(
        MIGRATION_STATE_DB_NAME,
        MIGRATION_STATE_DB_VERSION,
      );
      req.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(MIGRATION_STATE_STORE_NAME)) {
          db.createObjectStore(MIGRATION_STATE_STORE_NAME, {
            keyPath: "dbName",
          });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          try {
            db.close();
          } catch {
            // ignore
          }
          stateDbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        stateDbPromise = null;
        resolve(null);
      };
      req.onblocked = () => {
        stateDbPromise = null;
        resolve(null);
      };
    } catch {
      stateDbPromise = null;
      resolve(null);
    }
  });

  return stateDbPromise;
}

export function isCheckpointValid(value: unknown): value is MigrationCheckpoint {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const c = value as Record<string, unknown>;
  if (typeof c.dbName !== "string" || !c.dbName) return false;
  if (typeof c.targetVersion !== "number" || !Number.isFinite(c.targetVersion)) {
    return false;
  }
  if (typeof c.appliedVersion !== "number" || c.appliedVersion < 0) {
    return false;
  }
  if (
    typeof c.lastKnownValidVersion !== "number" ||
    c.lastKnownValidVersion < 0
  ) {
    return false;
  }
  if (!Array.isArray(c.completedStructuralStepIds)) return false;
  if (!Array.isArray(c.completedDataStepIds)) return false;
  if (
    c.dataCursor !== null &&
    typeof c.dataCursor !== "string" &&
    typeof c.dataCursor !== "number"
  ) {
    return false;
  }
  return true;
}

export async function loadMigrationCheckpoint(
  dbName: string,
): Promise<MigrationCheckpoint | null> {
  const db = await openMigrationStateDB();
  if (!db) {
    return checkpointMirror.get(dbName) ?? null;
  }

  return new Promise((resolve) => {
    try {
      if (!db.objectStoreNames.contains(MIGRATION_STATE_STORE_NAME)) {
        resolve(checkpointMirror.get(dbName) ?? null);
        return;
      }
      const tx = db.transaction([MIGRATION_STATE_STORE_NAME], "readonly");
      const req = tx.objectStore(MIGRATION_STATE_STORE_NAME).get(dbName);
      req.onsuccess = () => {
        const raw = req.result;
        if (raw === undefined) {
          resolve(checkpointMirror.get(dbName) ?? null);
          return;
        }
        if (!isCheckpointValid(raw)) {
          recordDiagnosticEvent({
            timestamp: Date.now(),
            dbName,
            context: detectContextKind(),
            phase: "FAILED",
            errorCode: "MALFORMED_RECORD",
            message:
              "Detected malformed migration checkpoint state; resetting cursor metadata safely without altering target stores.",
          });
          resolve(null);
          return;
        }
        checkpointMirror.set(dbName, raw);
        resolve(raw);
      };
      req.onerror = () => resolve(checkpointMirror.get(dbName) ?? null);
    } catch {
      resolve(checkpointMirror.get(dbName) ?? null);
    }
  });
}

export async function saveMigrationCheckpoint(
  checkpoint: MigrationCheckpoint,
): Promise<void> {
  const next: MigrationCheckpoint = {
    ...checkpoint,
    updatedAt: Date.now(),
  };
  checkpointMirror.set(next.dbName, next);

  const db = await openMigrationStateDB();
  if (!db || !db.objectStoreNames.contains(MIGRATION_STATE_STORE_NAME)) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    try {
      const tx = db.transaction([MIGRATION_STATE_STORE_NAME], "readwrite");
      tx.objectStore(MIGRATION_STATE_STORE_NAME).put(next);
      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(
          classifyError(
            tx.error || new DOMException("Checkpoint aborted", "AbortError"),
            next.dbName,
          ),
        );
      tx.onerror = () =>
        reject(
          classifyError(
            tx.error || new Error("Checkpoint write failed"),
            next.dbName,
          ),
        );
    } catch (err) {
      reject(classifyError(err, next.dbName));
    }
  });
}

export async function clearMigrationCheckpoint(dbName: string): Promise<void> {
  checkpointMirror.delete(dbName);
  const db = await openMigrationStateDB();
  if (!db || !db.objectStoreNames.contains(MIGRATION_STATE_STORE_NAME)) {
    return;
  }

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction([MIGRATION_STATE_STORE_NAME], "readwrite");
      tx.objectStore(MIGRATION_STATE_STORE_NAME).delete(dbName);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function detectExistingDatabaseVersion(
  dbName: string,
): Promise<number | null> {
  if (
    typeof indexedDB !== "undefined" &&
    typeof indexedDB.databases === "function"
  ) {
    try {
      const list = await indexedDB.databases();
      const match = list.find((entry) => entry.name === dbName);
      if (match && typeof match.version === "number") {
        return match.version;
      }
      return 0;
    } catch {
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Core Coordinated Open & Migration Protocol
// ---------------------------------------------------------------------------

function createDefaultDefinition(
  dbName: string,
  targetVersion: number,
): DatabaseMigrationDefinition {
  return {
    dbName,
    currentVersion: targetVersion,
    requiredStores: [],
    structuralMigrations: [],
    dataMigrations: [],
  };
}

/**
 * Opens an IndexedDB database through the coordinated, crash-safe migration pipeline.
 * Accepts either a registered database name or an explicit `DatabaseMigrationDefinition`.
 */
export async function openDatabaseWithMigration(
  dbNameOrDefinition: string | DatabaseMigrationDefinition,
  options: CoordinateOpenOptions = {},
): Promise<IDBDatabase> {
  const definition =
    typeof dbNameOrDefinition === "string"
      ? (getMigrationRegistry(dbNameOrDefinition) ??
        createDefaultDefinition(
          dbNameOrDefinition,
          options.targetVersion ?? 1,
        ))
      : dbNameOrDefinition;

  const dbName = definition.dbName;
  const targetVersion = options.targetVersion ?? definition.currentVersion;
  const context = detectContextKind(options.context);

  if (typeof indexedDB === "undefined") {
    throw new MigrationError(
      "INDEXEDDB_UNAVAILABLE",
      dbName,
      "IndexedDB is not available in this environment.",
      { recoverable: false },
    );
  }

  if (options.signal?.aborted) {
    throw new MigrationError(
      "TRANSACTION_ABORTED",
      dbName,
      `Migration for '${dbName}' was aborted prior to start.`,
      { recoverable: true },
    );
  }

  // Prevent accidental schema downgrades before calling indexedDB.open()
  const existingVersion = await detectExistingDatabaseVersion(dbName);
  if (existingVersion !== null && existingVersion > targetVersion) {
    const err = new MigrationError(
      "VERSION_DOWNGRADE",
      dbName,
      `Refusing schema downgrade for '${dbName}': existing version (${existingVersion}) is newer than requested version (${targetVersion}).`,
      { recoverable: false },
    );
    recordDiagnosticEvent({
      timestamp: Date.now(),
      dbName,
      context,
      phase: "FAILED",
      version: targetVersion,
      errorCode: err.code,
      message: err.message,
    });
    throw err;
  }

  // Serialize multi-tab / multi-context migrations per database via Web Locks
  return withWebLock(
    async () => {
      // Ensure channel listener is active
      getCoordinationChannel();

      // Load durable checkpoint or initialize a new one
      const existingCheckpoint = await loadMigrationCheckpoint(dbName);
      const checkpoint: MigrationCheckpoint = existingCheckpoint
        ? {
            ...existingCheckpoint,
            targetVersion,
            phase: "COORDINATING",
            lastError: undefined,
            updatedAt: Date.now(),
          }
        : {
            dbName,
            targetVersion,
            appliedVersion: existingVersion ?? 0,
            lastKnownValidVersion: existingVersion ?? 0,
            phase: "COORDINATING",
            completedStructuralStepIds: [],
            completedDataStepIds: [],
            activeDataStepId: null,
            dataCursor: null,
            processedRecords: 0,
            malformedRecordCount: 0,
            malformedRecordSummaries: [],
            updatedAt: Date.now(),
          };

      await saveMigrationCheckpoint(checkpoint);

      // If we know an upgrade is needed or stale handles exist, notify peer contexts
      const needsUpgradeSignal =
        existingVersion === null ||
        existingVersion < targetVersion ||
        (activeConnections.get(dbName)?.size ?? 0) > 0;

      if (needsUpgradeSignal) {
        upgradingDatabases.add(dbName);
        closeDatabaseConnections(dbName);
        postCoordinationMessage({
          type: "UPGRADE_REQUESTED",
          dbName,
          targetVersion,
        });
      }

      let db: IDBDatabase | null = null;

      try {
        db = await openStructuralConnection(
          definition,
          targetVersion,
          checkpoint,
          context,
          options,
        );

        // Post-upgrade schema validation
        checkpoint.phase = "VALIDATING";
        await saveMigrationCheckpoint(checkpoint);

        if (definition.requiredStores.length > 0) {
          const validation = validateRequiredStores(
            db,
            definition.requiredStores,
          );
          if (!validation.valid) {
            const missingMsg = [
              validation.missingStores.length > 0
                ? `missing stores [${validation.missingStores.join(", ")}]`
                : "",
              validation.missingIndexes.length > 0
                ? `missing indexes [${validation.missingIndexes
                    .map((i) => `${i.storeName}.${i.indexName}`)
                    .join(", ")}]`
                : "",
            ]
              .filter(Boolean)
              .join("; ");

            try {
              db.close();
            } catch {
              // ignore
            }
            staleConnections.add(db);
            throw new MigrationError(
              "SCHEMA_VALIDATION_FAILED",
              dbName,
              `Post-upgrade schema validation failed for '${dbName}': ${missingMsg}`,
              { recoverable: false },
            );
          }
        }

        checkpoint.lastKnownValidVersion = db.version;
        checkpoint.appliedVersion = db.version;

        // Run resumable, batched data migrations outside onupgradeneeded
        if (!options.skipDataMigrations && definition.dataMigrations.length > 0) {
          checkpoint.phase = "DATA_MIGRATION";
          await saveMigrationCheckpoint(checkpoint);

          const sortedData = sortDataSteps(definition.dataMigrations);
          for (const step of sortedData) {
            if (step.version > db.version) continue;
            if (checkpoint.completedDataStepIds.includes(step.id)) continue;

            const resumeCursor =
              checkpoint.activeDataStepId === step.id
                ? checkpoint.dataCursor
                : null;

            checkpoint.activeDataStepId = step.id;
            await saveMigrationCheckpoint(checkpoint);

            const result = await step.migrate({
              db,
              dbName,
              fromVersion: checkpoint.lastKnownValidVersion,
              toVersion: db.version,
              resumeCursor,
              processedCount: checkpoint.processedRecords,
              batchSize: step.batchSize ?? 50,
              signal: options.signal,
              saveCheckpoint: async (cursor, processedDelta = 0) => {
                checkpoint.dataCursor = cursor;
                checkpoint.processedRecords += processedDelta;
                await saveMigrationCheckpoint(checkpoint);
              },
              reportMalformedRecord: (storeName, recordKey, reason) => {
                checkpoint.malformedRecordCount += 1;
                if (
                  checkpoint.malformedRecordSummaries.length <
                  MAX_MALFORMED_SUMMARIES
                ) {
                  const summary: MalformedRecordSummary = {
                    storeName,
                    keyHash: sanitizeRecordKeyForLog(recordKey),
                    reason,
                    detectedAt: Date.now(),
                  };
                  checkpoint.malformedRecordSummaries.push(summary);
                }
                recordDiagnosticEvent({
                  timestamp: Date.now(),
                  dbName,
                  context,
                  phase: "DATA_MIGRATION",
                  errorCode: "MALFORMED_RECORD",
                  message: `Malformed record detected in store '${storeName}' (${sanitizeRecordKeyForLog(recordKey)}): ${reason}`,
                });
              },
            });

            if (!checkpoint.completedDataStepIds.includes(step.id)) {
              checkpoint.completedDataStepIds.push(step.id);
            }
            checkpoint.activeDataStepId = null;
            checkpoint.dataCursor = null;
            checkpoint.processedRecords +=
              result.processedCount > 0 ? 0 : 0; // Already tracked per batch; ensure persistence
            await saveMigrationCheckpoint(checkpoint);
          }
        }

        checkpoint.phase = "COMPLETED";
        checkpoint.lastError = undefined;
        await saveMigrationCheckpoint(checkpoint);

        upgradingDatabases.delete(dbName);
        registerActiveConnection(dbName, db);

        postCoordinationMessage({
          type: "UPGRADE_COMPLETED",
          dbName,
          targetVersion,
          appliedVersion: db.version,
        });

        recordDiagnosticEvent({
          timestamp: Date.now(),
          dbName,
          context,
          phase: "COMPLETED",
          version: db.version,
          message: `Database '${dbName}' ready at version ${db.version}`,
        });

        return db;
      } catch (err) {
        const migrationErr = classifyError(err, dbName);
        checkpoint.phase =
          migrationErr.code === "BLOCKED_UPGRADE" ? "BLOCKED" : "FAILED";
        checkpoint.lastError = {
          code: migrationErr.code,
          message: migrationErr.message,
          recoverable: migrationErr.recoverable,
          timestamp: Date.now(),
        };

        // Best-effort checkpoint persist (ignore secondary error if quota is full)
        try {
          await saveMigrationCheckpoint(checkpoint);
        } catch {
          checkpointMirror.set(dbName, { ...checkpoint, updatedAt: Date.now() });
        }

        upgradingDatabases.delete(dbName);
        postCoordinationMessage({
          type: "UPGRADE_FAILED",
          dbName,
          targetVersion,
          errorCode: migrationErr.code,
        });

        recordDiagnosticEvent({
          timestamp: Date.now(),
          dbName,
          context,
          phase: checkpoint.phase as MigrationPhase,
          version: targetVersion,
          errorCode: migrationErr.code,
          message: migrationErr.message,
        });

        if (db) {
          staleConnections.add(db);
          try {
            db.close();
          } catch {
            // ignore
          }
        }

        throw migrationErr;
      }
    },
    `worksphere:idb-migration:${dbName}`,
    { timeoutMs: options.timeoutMs ?? DEFAULT_MIGRATION_TIMEOUT_MS },
  );
}

async function openStructuralConnection(
  definition: DatabaseMigrationDefinition,
  targetVersion: number,
  checkpoint: MigrationCheckpoint,
  context: MigrationContextKind,
  options: CoordinateOpenOptions,
): Promise<IDBDatabase> {
  const dbName = definition.dbName;
  const timeoutMs = options.timeoutMs ?? DEFAULT_MIGRATION_TIMEOUT_MS;
  const blockedTimeoutMs = options.blockedTimeoutMs ?? DEFAULT_BLOCKED_TIMEOUT_MS;

  return new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    let blockedTimer: ReturnType<typeof setTimeout> | null = null;
    let upgradeTxError: MigrationError | null = null;

    const cleanupTimers = () => {
      clearTimeout(openTimer);
      if (blockedTimer) {
        clearTimeout(blockedTimer);
        blockedTimer = null;
      }
    };

    const fail = (err: unknown, fallbackCode?: MigrationErrorCode) => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      reject(classifyError(err, dbName, fallbackCode));
    };

    const openTimer = setTimeout(() => {
      fail(
        new MigrationError(
          "TIMEOUT",
          dbName,
          `IndexedDB open/upgrade for '${dbName}' timed out after ${timeoutMs}ms.`,
          { recoverable: true },
        ),
      );
    }, timeoutMs);

    try {
      const request = indexedDB.open(dbName, targetVersion);

      request.onblocked = () => {
        recordDiagnosticEvent({
          timestamp: Date.now(),
          dbName,
          context,
          phase: "BLOCKED",
          version: targetVersion,
          errorCode: "BLOCKED_UPGRADE",
          message: `Upgrade of '${dbName}' to v${targetVersion} blocked by another open connection`,
        });

        closeDatabaseConnections(dbName);
        postCoordinationMessage({
          type: "UPGRADE_BLOCKED",
          dbName,
          targetVersion,
        });
        options.onBlocked?.();

        if (!blockedTimer) {
          blockedTimer = setTimeout(() => {
            fail(
              new MigrationError(
                "BLOCKED_UPGRADE",
                dbName,
                `IndexedDB upgrade of '${dbName}' to v${targetVersion} remained blocked after ${blockedTimeoutMs}ms. Existing data was preserved.`,
                { recoverable: true },
              ),
            );
          }, blockedTimeoutMs);
        }
      };

      request.onupgradeneeded = (event) => {
        if (blockedTimer) {
          clearTimeout(blockedTimer);
          blockedTimer = null;
        }

        const db = (event.target as IDBOpenDBRequest).result;
        const tx = (event.target as IDBOpenDBRequest).transaction;
        const oldVersion = event.oldVersion;
        const newVersion = event.newVersion ?? targetVersion;

        checkpoint.phase = "STRUCTURAL";
        checkpoint.lastKnownValidVersion = oldVersion;
        checkpointMirror.set(dbName, { ...checkpoint, updatedAt: Date.now() });

        db.onversionchange = (vcEvent) => {
          staleConnections.add(db);
          try {
            db.close();
          } catch {
            // ignore
          }
          options.onVersionChange?.(vcEvent);
        };

        if (tx) {
          tx.onabort = () => {
            upgradeTxError = classifyError(
              tx.error ||
                new DOMException("Upgrade transaction aborted", "AbortError"),
              dbName,
              "TRANSACTION_ABORTED",
            );
          };
          tx.onerror = () => {
            upgradeTxError = classifyError(
              tx.error || new Error("Upgrade transaction error"),
              dbName,
              "UPGRADE_FAILED",
            );
          };
        }

        const sortedSteps = sortStructuralSteps(definition.structuralMigrations);
        for (const step of sortedSteps) {
          if (step.version > oldVersion && step.version <= newVersion) {
            try {
              step.upgrade(db, tx, oldVersion, newVersion);
              if (!checkpoint.completedStructuralStepIds.includes(step.id)) {
                checkpoint.completedStructuralStepIds.push(step.id);
              }
            } catch (err) {
              upgradeTxError = classifyError(err, dbName);
              try {
                tx?.abort();
              } catch {
                // ignore abort errors
              }
              fail(upgradeTxError);
              return;
            }
          }
        }
      };

      request.onerror = () => {
        const err = upgradeTxError || request.error || new Error("IndexedDB open error");
        fail(err);
      };

      request.onsuccess = () => {
        if (settled) {
          try {
            request.result.close();
          } catch {
            // ignore
          }
          return;
        }
        settled = true;
        cleanupTimers();

        const db = request.result;
        db.onversionchange = (vcEvent) => {
          staleConnections.add(db);
          const set = activeConnections.get(dbName);
          if (set) {
            set.delete(db);
          }
          try {
            db.close();
          } catch {
            // ignore
          }
          recordDiagnosticEvent({
            timestamp: Date.now(),
            dbName,
            context,
            phase: "COORDINATING",
            version: db.version,
            message: `Closed '${dbName}' connection on versionchange event`,
          });
          options.onVersionChange?.(vcEvent);
        };

        resolve(db);
      };
    } catch (err) {
      fail(err);
    }
  });
}

// ---------------------------------------------------------------------------
// Observability & Testing Helpers
// ---------------------------------------------------------------------------

export async function getMigrationDiagnostics(
  dbName: string,
): Promise<MigrationDiagnosticSnapshot> {
  const checkpoint = await loadMigrationCheckpoint(dbName);
  return {
    dbName,
    checkpoint,
    activeConnectionCount: activeConnections.get(dbName)?.size ?? 0,
    upgradeInProgress: upgradingDatabases.has(dbName),
    recentEvents: diagnosticEvents.filter((e) => e.dbName === dbName),
  };
}

export function getMigrationProgress(
  dbName: string,
): MigrationCheckpoint | undefined {
  return checkpointMirror.get(dbName);
}

export function getRecentMigrationEvents(): MigrationDiagnosticEvent[] {
  return [...diagnosticEvents];
}

export async function resetMigrationCoordinator(
  options: { clearCheckpoints?: boolean } = {},
): Promise<void> {
  closeAllManagedConnections();
  activeConnections.clear();
  upgradingDatabases.clear();
  diagnosticEvents.length = 0;

  if (options.clearCheckpoints) {
    const names = Array.from(checkpointMirror.keys());
    for (const name of names) {
      await clearMigrationCheckpoint(name);
    }
    checkpointMirror.clear();
  } else {
    checkpointMirror.clear();
  }

  if (coordinationChannel) {
    try {
      coordinationChannel.close();
    } catch {
      // ignore
    }
    coordinationChannel = null;
  }

  if (stateDbPromise) {
    try {
      const db = await stateDbPromise;
      db?.close();
    } catch {
      // ignore
    }
    stateDbPromise = null;
  }
}
