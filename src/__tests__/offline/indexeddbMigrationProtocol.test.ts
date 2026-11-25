/**
 * src/__tests__/offline/indexeddbMigrationProtocol.test.ts
 *
 * Comprehensive verification suite for Issue #10169:
 * Crash-safe, multi-context IndexedDB schema migration protocol across
 * tabs, pages, Web Workers, and Service Workers.
 */

import "fake-indexeddb/auto";
import fs from "fs";
import path from "path";
import {
  MIGRATION_BROADCAST_CHANNEL,
  MIGRATION_STATE_DB_NAME,
  assertConnectionUsable,
  clearMigrationCheckpoint,
  getMigrationDiagnostics,
  handleCoordinationMessage,
  isConnectionValid,
  isUpgradeInProgress,
  loadMigrationCheckpoint,
  openDatabaseWithMigration,
  resetMigrationCoordinator,
  saveMigrationCheckpoint,
} from "@/lib/offline/migrationCoordinator";
import {
  bookingDraftsDbRegistry,
  getMigrationRegistry,
  offlineMutationsDbRegistry,
  registerDatabaseMigration,
  validateRequiredStores,
  worksphereOfflineDbRegistry,
  worksphereOfflineRegistry,
} from "@/lib/offline/migrations/migrationRegistry";
import { runResumableStoreDataMigration } from "@/lib/offline/migrations/dataMigrationRunner";
import {
  DatabaseMigrationDefinition,
  MigrationError,
} from "@/lib/offline/migrations/types";
import { DraftStore, BookingDraft } from "@/worker/bookingSync/DraftStore";
import {
  IndexedDBMutationStorage,
  OFFLINE_MUTATIONS_DB_NAME,
  OFFLINE_MUTATIONS_STORE_NAME,
} from "@/core/sync/OfflineMutationQueue";
import {
  CHECKIN_STORE_NAME,
  DEFAULT_OFFLINE_DB_NAME,
  enqueueCheckin,
  getPendingCheckins,
} from "@/lib/offline/syncQueue";

async function deleteDb(name: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

async function seedLegacyDatabase(
  dbName: string,
  version: number,
  onUpgrade: (db: IDBDatabase, tx: IDBTransaction) => void,
  onSeed?: (db: IDBDatabase) => Promise<void>,
): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(dbName, version);
    req.onupgradeneeded = () => {
      onUpgrade(req.result, req.transaction!);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  if (onSeed) {
    await onSeed(db);
  }
  db.close();
}

function readAllFromStore<T = Record<string, unknown>>(
  db: IDBDatabase,
  storeName: string,
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName], "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve((req.result as T[]) || []);
    req.onerror = () => reject(req.error);
  });
}

describe("Crash-Safe IndexedDB Schema Migration Protocol (#10169)", () => {
  const allDbNames = [
    "worksphere-offline",
    "WorkSphereOfflineDB",
    "WorkSphereBookingDB",
    "WorkSphereOfflineMutationsDB",
    MIGRATION_STATE_DB_NAME,
  ];

  beforeEach(async () => {
    await resetMigrationCoordinator({ clearCheckpoints: true });
    for (const name of allDbNames) {
      await deleteDb(name);
    }
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await resetMigrationCoordinator({ clearCheckpoints: true });
  });

  it("1. upgrades empty databases from oldest supported schema in deterministic version order", async () => {
    const executionOrder: number[] = [];
    const customDbName = "WorkSphereOrderTestDB";
    await deleteDb(customDbName);

    const def: DatabaseMigrationDefinition = {
      dbName: customDbName,
      currentVersion: 4,
      requiredStores: [
        { name: "alpha", keyPath: "id" },
        {
          name: "beta",
          keyPath: "id",
          indexes: [{ name: "status", keyPath: "status", unique: false }],
        },
      ],
      structuralMigrations: [
        {
          id: "step-v4",
          version: 4,
          description: "v4 index",
          upgrade: (db, tx) => {
            executionOrder.push(4);
            const store = tx!.objectStore("beta");
            if (!store.indexNames.contains("status")) {
              store.createIndex("status", "status", { unique: false });
            }
          },
        },
        {
          id: "step-v1",
          version: 1,
          description: "v1 alpha",
          upgrade: (db) => {
            executionOrder.push(1);
            if (!db.objectStoreNames.contains("alpha")) {
              db.createObjectStore("alpha", { keyPath: "id" });
            }
          },
        },
        {
          id: "step-v2",
          version: 2,
          description: "v2 beta",
          upgrade: (db) => {
            executionOrder.push(2);
            if (!db.objectStoreNames.contains("beta")) {
              db.createObjectStore("beta", { keyPath: "id" });
            }
          },
        },
      ],
      dataMigrations: [],
    };

    const db = await openDatabaseWithMigration(def);
    expect(executionOrder).toEqual([1, 2, 4]);
    expect(db.version).toBe(4);
    expect(validateRequiredStores(db, def.requiredStores).valid).toBe(true);
    db.close();
    await deleteDb(customDbName);

    // Verify all 4 canonical registries initialize cleanly from empty
    for (const reg of [
      worksphereOfflineRegistry,
      worksphereOfflineDbRegistry,
      bookingDraftsDbRegistry,
      offlineMutationsDbRegistry,
    ]) {
      const opened = await openDatabaseWithMigration(reg.dbName);
      expect(opened.version).toBe(reg.currentVersion);
      const validation = validateRequiredStores(opened, reg.requiredStores);
      expect(validation.valid).toBe(true);
      opened.close();
    }
  });

  it("2. upgrades WorkSphereBookingDB from v1 to v2 while preserving pending booking drafts and unknown fields", async () => {
    await seedLegacyDatabase(
      "WorkSphereBookingDB",
      1,
      (db) => {
        db.createObjectStore("booking_drafts", { keyPath: "id" });
      },
      async (db) => {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(["booking_drafts"], "readwrite");
          tx.objectStore("booking_drafts").put({
            id: "legacy-draft-1",
            venueId: "venue-nyc-1",
            userId: "user-42",
            payload: { seatCode: "B12", date: "2026-12-01" },
            legacyCustomField: "preserve-me",
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      },
    );

    const db = await openDatabaseWithMigration("WorkSphereBookingDB");
    expect(db.version).toBe(2);

    const drafts = await readAllFromStore<Record<string, unknown>>(
      db,
      "booking_drafts",
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].id).toBe("legacy-draft-1");
    expect(drafts[0].legacyCustomField).toBe("preserve-me");
    expect(drafts[0].vectorClock).toEqual({ "user-42": 1, server: 0 });
    db.close();
  });

  it("3 & 10. upgrades worksphere-offline containing legacy check-ins & reviews, retaining IDs and idempotency keys", async () => {
    await seedLegacyDatabase(
      DEFAULT_OFFLINE_DB_NAME,
      6,
      (db) => {
        db.createObjectStore("venues", { keyPath: "id" });
        db.createObjectStore("favorites", { keyPath: "id" });
        db.createObjectStore("searches", { keyPath: "query" });
        db.createObjectStore("pendingActions", {
          keyPath: "id",
          autoIncrement: true,
        });
        const reviews = db.createObjectStore("pendingReviews", { keyPath: "id" });
        reviews.createIndex("venueId", "venueId", { unique: false });
      },
      async (db) => {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(
            ["pendingActions", "pendingReviews"],
            "readwrite",
          );
          tx.objectStore("pendingActions").put({
            type: "CHECKIN",
            venueId: "venue-legacy",
          });
          tx.objectStore("pendingReviews").put({
            id: "rev-idemp-001",
            venueId: "venue-legacy",
            baseReviewUpdatedAt: "2026-10-01T00:00:00Z",
            data: { wifiQuality: 5, hasOutlets: true, noiseLevel: "quiet" },
            customLegacyMeta: { source: "v6-pwa" },
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      },
    );

    const db = await openDatabaseWithMigration(DEFAULT_OFFLINE_DB_NAME);
    expect(db.version).toBe(9);
    expect(db.objectStoreNames.contains(CHECKIN_STORE_NAME)).toBe(true);

    const reviews = await readAllFromStore<Record<string, unknown>>(
      db,
      "pendingReviews",
    );
    expect(reviews).toHaveLength(1);
    expect(reviews[0].id).toBe("rev-idemp-001");
    expect(reviews[0].baseVersionTimestamp).toBe("2026-10-01T00:00:00Z");
    expect(reviews[0].customLegacyMeta).toEqual({ source: "v6-pwa" });
    db.close();

    // Enqueue a check-in on the upgraded v9 DB and verify idempotency key retention
    const checkin = await enqueueCheckin({
      seatId: "DESK-7",
      venueId: "venue-legacy",
      idempotencyKey: "idemp-desk-7-abc",
    });
    const pending = await getPendingCheckins();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(checkin.id);
    expect(pending[0].idempotencyKey).toBe("idemp-desk-7-abc");
  });

  it("4. coordinates upgrades across multiple open connections, handling versionchange and blocked upgrades without data loss", async () => {
    // Open a legacy v1 connection in a simulated second tab
    const legacyTabDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("WorkSphereBookingDB", 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("booking_drafts", { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    await new Promise<void>((resolve, reject) => {
      const tx = legacyTabDb.transaction(["booking_drafts"], "readwrite");
      tx.objectStore("booking_drafts").put({
        id: "tab1-draft",
        venueId: "v-1",
        userId: "u-1",
        payload: { seat: "A1" },
        timestamp: 1000,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    let tab1VersionChanged = false;
    legacyTabDb.onversionchange = () => {
      tab1VersionChanged = true;
      legacyTabDb.close();
    };

    // Tab 2 initiates coordinated v2 upgrade
    const tab2Db = await openDatabaseWithMigration("WorkSphereBookingDB");
    expect(tab1VersionChanged).toBe(true);
    expect(tab2Db.version).toBe(2);

    const drafts = await readAllFromStore<BookingDraft>(
      tab2Db,
      "booking_drafts",
    );
    expect(drafts.some((d) => d.id === "tab1-draft")).toBe(true);

    // Simulate BroadcastChannel UPGRADE_REQUESTED from another tab
    handleCoordinationMessage({
      type: "UPGRADE_REQUESTED",
      dbName: "WorkSphereBookingDB",
      targetVersion: 3,
      senderId: "remote-tab-99",
      timestamp: Date.now(),
    });

    expect(isUpgradeInProgress("WorkSphereBookingDB")).toBe(true);
    expect(isConnectionValid(tab2Db)).toBe(false);
    expect(() => assertConnectionUsable("WorkSphereBookingDB", tab2Db)).toThrow(
      MigrationError,
    );

    handleCoordinationMessage({
      type: "UPGRADE_COMPLETED",
      dbName: "WorkSphereBookingDB",
      targetVersion: 3,
      appliedVersion: 3,
      senderId: "remote-tab-99",
      timestamp: Date.now(),
    });
    expect(isUpgradeInProgress("WorkSphereBookingDB")).toBe(false);
  });

  it("4b. handles persistently blocked upgrade with BLOCKED_UPGRADE error without deleting data", async () => {
    const blockingDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("WorkSphereBookingDB", 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("booking_drafts", { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    await new Promise<void>((resolve, reject) => {
      const tx = blockingDb.transaction(["booking_drafts"], "readwrite");
      tx.objectStore("booking_drafts").put({
        id: "keep-on-blocked",
        venueId: "v-1",
        userId: "u-1",
        payload: {},
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    // Intentionally refuse to close on versionchange to simulate suspended tab
    blockingDb.onversionchange = () => {
      // Do not close
    };

    let blockedCallbackCalled = false;
    await expect(
      openDatabaseWithMigration("WorkSphereBookingDB", {
        blockedTimeoutMs: 60,
        timeoutMs: 1000,
        onBlocked: () => {
          blockedCallbackCalled = true;
        },
      }),
    ).rejects.toMatchObject({
      name: "MigrationError",
      code: "BLOCKED_UPGRADE",
      recoverable: true,
    });

    expect(blockedCallbackCalled).toBe(true);

    // Verify existing data was NOT deleted
    const preserved = await readAllFromStore<BookingDraft>(
      blockingDb,
      "booking_drafts",
    );
    expect(preserved).toHaveLength(1);
    expect(preserved[0].id).toBe("keep-on-blocked");
    blockingDb.close();
  });

  it("5. coordinates between page and Service Worker (public/sw.js) without schema mismatch", async () => {
    const swPath = path.resolve(process.cwd(), "public/sw.js");
    const swCode = fs.readFileSync(swPath, "utf8");

    // Extract SW openIndexedDB and run it against the shared database
    const fnMatch = swCode.match(
      /let swDb = null;[\s\S]*?function openIndexedDB\(\) \{[\s\S]*?\n\}/,
    );
    expect(fnMatch).not.toBeNull();
    const swOpenIndexedDB = new Function(
      fnMatch![0] + "; return openIndexedDB;",
    )() as () => Promise<IDBDatabase>;

    // Service Worker opens worksphere-offline first
    const swDb = await swOpenIndexedDB();
    expect(swDb.version).toBe(9);
    const registry = getMigrationRegistry("worksphere-offline")!;
    expect(validateRequiredStores(swDb, registry.requiredStores).valid).toBe(
      true,
    );
    swDb.close();

    // Page opens via coordinator cleanly without VersionError or missing stores
    const pageDb = await openDatabaseWithMigration("worksphere-offline", {
      context: "page",
    });
    expect(pageDb.version).toBe(9);
    expect(validateRequiredStores(pageDb, registry.requiredStores).valid).toBe(
      true,
    );
    pageDb.close();

    // Verify SW mutations DB version matches registry (v2)
    expect(swCode).toContain(
      'indexedDB.open("WorkSphereOfflineMutationsDB", 2)',
    );
    expect(MIGRATION_BROADCAST_CHANNEL).toBe(
      "worksphere:idb-migration-coordination",
    );
  });

  it("6. aborts a data migration midway and resumes deterministically from the last committed cursor", async () => {
    const resumeTestDb = "WorkSphereResumeTestDB";
    await deleteDb(resumeTestDb);

    await seedLegacyDatabase(
      resumeTestDb,
      1,
      (db) => {
        db.createObjectStore("pendingReviews", { keyPath: "id" });
      },
      async (db) => {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(["pendingReviews"], "readwrite");
          const store = tx.objectStore("pendingReviews");
          for (let i = 1; i <= 5; i++) {
            store.put({
              id: `rev-0${i}`,
              venueId: "v-resume",
              baseReviewUpdatedAt: "2026-10-01T00:00:00Z",
              data: { wifiQuality: 4, hasOutlets: true, noiseLevel: "quiet" },
            });
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      },
    );

    const visitedKeysPerRun: string[][] = [];
    const controller = new AbortController();

    const makeDef = (abortAfterBatches?: number): DatabaseMigrationDefinition => {
      const visited: string[] = [];
      visitedKeysPerRun.push(visited);
      let batches = 0;

      return {
        dbName: resumeTestDb,
        currentVersion: 2,
        requiredStores: [{ name: "pendingReviews", keyPath: "id" }],
        structuralMigrations: [
          {
            id: "resume-v1",
            version: 1,
            description: "v1",
            upgrade: (db) => {
              if (!db.objectStoreNames.contains("pendingReviews")) {
                db.createObjectStore("pendingReviews", { keyPath: "id" });
              }
            },
          },
          {
            id: "resume-v2",
            version: 2,
            description: "v2",
            upgrade: () => {},
          },
        ],
        dataMigrations: [
          {
            id: "resume-data-step",
            version: 2,
            description: "Adapt reviews in batches of 2",
            storeNames: ["pendingReviews"],
            batchSize: 2,
            migrate: (ctx) =>
              runResumableStoreDataMigration(
                {
                  ...ctx,
                  saveCheckpoint: async (cursor, delta) => {
                    await ctx.saveCheckpoint(cursor, delta);
                    batches++;
                    if (
                      abortAfterBatches !== undefined &&
                      batches >= abortAfterBatches
                    ) {
                      controller.abort();
                    }
                  },
                },
                ["pendingReviews"],
                (_store, rec) => {
                  visited.push(String(rec.id));
                  return {
                    ...rec,
                    migratedCount: ((rec.migratedCount as number) || 0) + 1,
                  };
                },
              ),
          },
        ],
      };
    };

    // Run 1: abort immediately after batch 1 (2 records committed)
    await expect(
      openDatabaseWithMigration(makeDef(1), { signal: controller.signal }),
    ).rejects.toMatchObject({
      name: "MigrationError",
      code: "TRANSACTION_ABORTED",
    });

    const midCheckpoint = await loadMigrationCheckpoint(resumeTestDb);
    expect(midCheckpoint?.phase).toBe("FAILED");
    expect(midCheckpoint?.activeDataStepId).toBe("resume-data-step");
    expect(midCheckpoint?.dataCursor).toBe("s:0:s:rev-02");
    expect(visitedKeysPerRun[0]).toEqual(["rev-01", "rev-02"]);

    // Run 2: restart and verify it resumes strictly after rev-02 without duplicating batch 1
    const resumedDb = await openDatabaseWithMigration(makeDef(undefined));
    expect(visitedKeysPerRun[1]).toEqual(["rev-03", "rev-04", "rev-05"]);

    const records = await readAllFromStore<Record<string, unknown>>(
      resumedDb,
      "pendingReviews",
    );
    expect(records.map((r) => r.migratedCount)).toEqual([1, 1, 1, 1, 1]);

    const doneCheckpoint = await loadMigrationCheckpoint(resumeTestDb);
    expect(doneCheckpoint?.phase).toBe("COMPLETED");
    expect(doneCheckpoint?.completedDataStepIds).toContain("resume-data-step");

    resumedDb.close();
    await clearMigrationCheckpoint(resumeTestDb);
    await deleteDb(resumeTestDb);
  });

  it("7. surfaces QuotaExceededError as MigrationError rather than resolving silently as a successful write", async () => {
    const quotaDbName = "WorkSphereQuotaTestDB";
    await deleteDb(quotaDbName);

    const quotaDef: DatabaseMigrationDefinition = {
      dbName: quotaDbName,
      currentVersion: 1,
      requiredStores: [{ name: "offline_mutations", keyPath: "id" }],
      structuralMigrations: [
        {
          id: "quota-v1",
          version: 1,
          description: "Simulate quota error during upgrade",
          upgrade: () => {
            throw new DOMException(
              "Quota exceeded while allocating object store",
              "QuotaExceededError",
            );
          },
        },
      ],
      dataMigrations: [],
    };

    await expect(openDatabaseWithMigration(quotaDef)).rejects.toMatchObject({
      name: "MigrationError",
      code: "QUOTA_EXCEEDED",
      recoverable: true,
    });

    const diag = await getMigrationDiagnostics(quotaDbName);
    expect(diag.checkpoint?.phase).toBe("FAILED");
    expect(diag.checkpoint?.lastError?.code).toBe("QUOTA_EXCEEDED");

    // Also verify DraftStore & IndexedDBMutationStorage surface migration errors instead of swallowing them
    registerDatabaseMigration({
      ...offlineMutationsDbRegistry,
      structuralMigrations: [
        {
          id: "fail-quota",
          version: 2,
          description: "Quota fail",
          upgrade: () => {
            throw new DOMException("Disk full", "QuotaExceededError");
          },
        },
      ],
    });
    try {
      const mutStorage = new IndexedDBMutationStorage();
      await expect(
        mutStorage.saveItem({
          id: "mut-q1",
          payload: { x: 1 },
          status: "PENDING",
        }),
      ).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    } finally {
      registerDatabaseMigration(offlineMutationsDbRegistry);
      await deleteDb(quotaDbName);
    }
  });

  it("8. handles malformed legacy records safely and reports diagnostics without exposing sensitive payload content", async () => {
    await seedLegacyDatabase(
      "WorkSphereBookingDB",
      1,
      (db) => {
        db.createObjectStore("booking_drafts", { keyPath: "id" });
      },
      async (db) => {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(["booking_drafts"], "readwrite");
          const store = tx.objectStore("booking_drafts");
          // Valid draft
          store.put({
            id: "valid-draft-1",
            venueId: "v-1",
            userId: "u-1",
            payload: { secretNote: "TOP_SECRET_CUSTOMER_PII" },
          });
          // Malformed encrypted draft (missing encryptedPayload envelope)
          store.put({
            id: "bad-draft-99",
            venueId: "v-1",
            userId: "u-1",
            isEncrypted: true,
            encryptedPayload: { corrupt: true },
            sensitiveEmail: "alice@secret.example.com",
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      },
    );

    const db = await openDatabaseWithMigration("WorkSphereBookingDB");
    const drafts = await readAllFromStore<Record<string, unknown>>(
      db,
      "booking_drafts",
    );
    expect(drafts).toHaveLength(2);
    expect(drafts.find((d) => d.id === "valid-draft-1")).toBeDefined();

    const diag = await getMigrationDiagnostics("WorkSphereBookingDB");
    expect(diag.checkpoint?.malformedRecordCount).toBe(1);
    expect(diag.checkpoint?.malformedRecordSummaries[0].storeName).toBe(
      "booking_drafts",
    );

    // Ensure diagnostic events and summaries do NOT leak sensitive payload text
    const serializedDiag = JSON.stringify(diag);
    expect(serializedDiag).not.toContain("TOP_SECRET_CUSTOMER_PII");
    expect(serializedDiag).not.toContain("alice@secret.example.com");
    db.close();
  });

  it("9. preserves encrypted booking payloads so DraftStore can still decrypt them after v1 -> v2 migration", async () => {
    // Save an encrypted draft using DraftStore on a legacy v1 DB
    await seedLegacyDatabase("WorkSphereBookingDB", 1, (db) => {
      db.createObjectStore("booking_drafts", { keyPath: "id" });
    });

    const draftStore = new DraftStore();
    await draftStore.createDraft({
      id: "enc-draft-1",
      venueId: "venue-secure",
      userId: "user-enc",
      payload: {
        guestName: "Alice Encrypted",
        seatCode: "VIP-01",
      },
    });

    const rawBefore = await draftStore.getRawDraft("enc-draft-1");
    expect(rawBefore?.isEncrypted).toBe(true);
    expect(rawBefore?.encryptedPayload).toBeDefined();

    // Re-open via coordinator and read decrypted draft
    await resetMigrationCoordinator();
    const freshDraftStore = new DraftStore();
    const decrypted = await freshDraftStore.getDraft("enc-draft-1");
    expect(decrypted).toBeDefined();
    expect(decrypted?.payload).toEqual({
      guestName: "Alice Encrypted",
      seatCode: "VIP-01",
    });
  });

  it("11. preserves completed/synced operations and never re-queues them as pending during migration", async () => {
    await seedLegacyDatabase(
      OFFLINE_MUTATIONS_DB_NAME,
      1,
      (db) => {
        db.createObjectStore(OFFLINE_MUTATIONS_STORE_NAME, { keyPath: "id" });
      },
      async (db) => {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction([OFFLINE_MUTATIONS_STORE_NAME], "readwrite");
          const store = tx.objectStore(OFFLINE_MUTATIONS_STORE_NAME);
          store.put({
            id: "mut-completed-1",
            idempotencyKey: "idemp-completed-1",
            status: "COMPLETED",
            payload: { action: "book" },
          });
          store.put({
            id: "mut-pending-2",
            idempotencyKey: "idemp-pending-2",
            status: "PENDING",
            payload: { action: "checkin" },
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      },
    );

    const db = await openDatabaseWithMigration(OFFLINE_MUTATIONS_DB_NAME);
    expect(db.version).toBe(2);

    const items = await readAllFromStore<Record<string, unknown>>(
      db,
      OFFLINE_MUTATIONS_STORE_NAME,
    );
    const completed = items.find((i) => i.id === "mut-completed-1");
    const pending = items.find((i) => i.id === "mut-pending-2");

    expect(completed?.status).toBe("COMPLETED");
    expect(completed?.idempotencyKey).toBe("idemp-completed-1");
    expect(pending?.status).toBe("PENDING");
    expect(pending?.idempotencyKey).toBe("idemp-pending-2");
    db.close();
  });

  it("12. blocks older application contexts from downgrading a newer on-disk schema and recovers from malformed checkpoints", async () => {
    // Simulate newer deployment opening WorkSphereBookingDB at v3
    await seedLegacyDatabase(
      "WorkSphereBookingDB",
      3,
      (db) => {
        db.createObjectStore("booking_drafts", { keyPath: "id" });
      },
      async (db) => {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(["booking_drafts"], "readwrite");
          tx.objectStore("booking_drafts").put({
            id: "v3-draft",
            venueId: "v-3",
            userId: "u-3",
            payload: { newer: true },
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      },
    );

    // Older context tries to open at v2 -> must reject with VERSION_DOWNGRADE and NOT wipe data
    await expect(
      openDatabaseWithMigration("WorkSphereBookingDB", { targetVersion: 2 }),
    ).rejects.toMatchObject({
      name: "MigrationError",
      code: "VERSION_DOWNGRADE",
      recoverable: false,
    });

    // Verify v3 data is completely intact
    const verifyDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("WorkSphereBookingDB");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    expect(verifyDb.version).toBe(3);
    const rows = await readAllFromStore<Record<string, unknown>>(
      verifyDb,
      "booking_drafts",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("v3-draft");
    verifyDb.close();

    // Corrupt checkpoint state in WorkSphereMigrationStateDB and verify safe recovery
    await saveMigrationCheckpoint({
      dbName: "WorkSphereOfflineMutationsDB",
      targetVersion: 2,
      appliedVersion: 1,
      lastKnownValidVersion: 1,
      phase: "DATA_MIGRATION",
      completedStructuralStepIds: [],
      completedDataStepIds: [],
      activeDataStepId: "broken",
      dataCursor: { bad: "object" } as unknown as string,
      processedRecords: 0,
      malformedRecordCount: 0,
      malformedRecordSummaries: [],
      updatedAt: Date.now(),
    });

    const loaded = await loadMigrationCheckpoint("WorkSphereOfflineMutationsDB");
    expect(loaded).toBeNull(); // Malformed checkpoint rejected safely

    const mutDb = await openDatabaseWithMigration(OFFLINE_MUTATIONS_DB_NAME);
    expect(mutDb.version).toBe(2);
    mutDb.close();
  });
});
