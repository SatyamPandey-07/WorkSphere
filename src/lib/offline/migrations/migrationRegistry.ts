/**
 * src/lib/offline/migrations/migrationRegistry.ts
 *
 * Canonical, versioned IndexedDB migration registries shared across page scripts,
 * Web Workers, and Service Worker logic (#10169).
 *
 * Every structural step is idempotent, ordered deterministically by version,
 * and preserves existing object stores, indexes, and pending user operations.
 */

import { runResumableStoreDataMigration } from "./dataMigrationRunner";
import {
  DatabaseMigrationDefinition,
  StoreSchemaExpectation,
  StructuralMigrationStep,
  DataMigrationStep,
} from "./types";

const registries = new Map<string, DatabaseMigrationDefinition>();

/**
 * Idempotently creates or updates an object store and its expected indexes
 * inside an active `onupgradeneeded` transaction without wiping existing data.
 */
export function ensureStoreSchema(
  db: IDBDatabase,
  tx: IDBTransaction | null,
  spec: StoreSchemaExpectation,
): void {
  let store: IDBObjectStore | null = null;

  if (!db.objectStoreNames.contains(spec.name)) {
    const createOpts: IDBObjectStoreParameters = {};
    if (spec.keyPath !== undefined) {
      createOpts.keyPath = spec.keyPath;
    }
    if (spec.autoIncrement !== undefined) {
      createOpts.autoIncrement = spec.autoIncrement;
    }
    store = db.createObjectStore(spec.name, createOpts);
  } else if (tx) {
    try {
      store = tx.objectStore(spec.name);
    } catch {
      store = null;
    }
  }

  if (store && spec.indexes) {
    for (const idx of spec.indexes) {
      if (!store.indexNames.contains(idx.name)) {
        store.createIndex(idx.name, idx.keyPath, {
          unique: idx.unique ?? false,
          multiEntry: idx.multiEntry ?? false,
        });
      }
    }
  }
}

export function sortStructuralSteps(
  steps: StructuralMigrationStep[],
): StructuralMigrationStep[] {
  return [...steps].sort((a, b) =>
    a.version !== b.version ? a.version - b.version : a.id.localeCompare(b.id),
  );
}

export function sortDataSteps(steps: DataMigrationStep[]): DataMigrationStep[] {
  return [...steps].sort((a, b) =>
    a.version !== b.version ? a.version - b.version : a.id.localeCompare(b.id),
  );
}

export interface SchemaValidationResult {
  valid: boolean;
  missingStores: string[];
  missingIndexes: Array<{ storeName: string; indexName: string }>;
}

/**
 * Validates that all required object stores (and expected indexes when inspectable)
 * exist on the opened IndexedDB database.
 */
export function validateRequiredStores(
  db: IDBDatabase,
  requiredStores: StoreSchemaExpectation[],
): SchemaValidationResult {
  const missingStores: string[] = [];
  const missingIndexes: Array<{ storeName: string; indexName: string }> = [];

  for (const spec of requiredStores) {
    if (!db.objectStoreNames.contains(spec.name)) {
      missingStores.push(spec.name);
    }
  }

  if (missingStores.length === 0 && requiredStores.some((s) => s.indexes?.length)) {
    const storesWithIndexes = requiredStores.filter(
      (s) => s.indexes && s.indexes.length > 0,
    );
    if (storesWithIndexes.length > 0) {
      try {
        const tx = db.transaction(
          storesWithIndexes.map((s) => s.name),
          "readonly",
        );
        for (const spec of storesWithIndexes) {
          const store = tx.objectStore(spec.name);
          for (const idx of spec.indexes || []) {
            if (!store.indexNames.contains(idx.name)) {
              missingIndexes.push({
                storeName: spec.name,
                indexName: idx.name,
              });
            }
          }
        }
      } catch {
        // Store presence already validated; index inspection skipped if closed
      }
    }
  }

  return {
    valid: missingStores.length === 0 && missingIndexes.length === 0,
    missingStores,
    missingIndexes,
  };
}

// ---------------------------------------------------------------------------
// 1. Primary Shared PWA Database: "worksphere-offline" (Version 9)
// ---------------------------------------------------------------------------

export const WORKSPHERE_OFFLINE_REQUIRED_STORES: StoreSchemaExpectation[] = [
  {
    name: "venues",
    keyPath: "id",
    indexes: [
      { name: "type", keyPath: "type", unique: false },
      { name: "savedAt", keyPath: "savedAt", unique: false },
    ],
  },
  {
    name: "favorites",
    keyPath: "id",
    indexes: [{ name: "savedAt", keyPath: "savedAt", unique: false }],
  },
  {
    name: "searches",
    keyPath: "query",
    indexes: [{ name: "timestamp", keyPath: "timestamp", unique: false }],
  },
  {
    name: "pendingActions",
    keyPath: "id",
    autoIncrement: true,
  },
  {
    name: "imageCacheLRU",
    keyPath: "url",
    indexes: [{ name: "lastAccessed", keyPath: "lastAccessed", unique: false }],
  },
  {
    name: "receiptExports",
    keyPath: "bookingId",
    indexes: [
      { name: "status", keyPath: "status", unique: false },
      { name: "createdAt", keyPath: "createdAt", unique: false },
    ],
  },
  {
    name: "pendingFavorites",
    keyPath: "id",
    autoIncrement: true,
  },
  {
    name: "availabilityDeltas",
    keyPath: "venueId",
    indexes: [{ name: "timestamp", keyPath: "timestamp", unique: false }],
  },
  {
    name: "recentlyViewedVenues",
    keyPath: "id",
    indexes: [{ name: "viewedAt", keyPath: "viewedAt", unique: false }],
  },
  {
    name: "pendingReviews",
    keyPath: "id",
    indexes: [
      { name: "venueId", keyPath: "venueId", unique: false },
      { name: "status", keyPath: "status", unique: false },
      { name: "createdAt", keyPath: "createdAt", unique: false },
    ],
  },
  {
    name: "preference_rankings",
    keyPath: "id",
  },
  {
    name: "queued_reviews",
    keyPath: "id",
    indexes: [
      { name: "venueId", keyPath: "venueId", unique: false },
      { name: "status", keyPath: "status", unique: false },
      { name: "createdAt", keyPath: "createdAt", unique: false },
    ],
  },
  {
    name: "unsyncedReviewDrafts",
    keyPath: "id",
    indexes: [
      { name: "venueId", keyPath: "review.venueId", unique: false },
      { name: "quarantinedAt", keyPath: "quarantinedAt", unique: false },
    ],
  },
  {
    name: "pendingCheckins",
    keyPath: "id",
    indexes: [
      { name: "seatId", keyPath: "seatId", unique: false },
      { name: "idempotencyKey", keyPath: "idempotencyKey", unique: true },
      { name: "status", keyPath: "status", unique: false },
      { name: "timestamp", keyPath: "timestamp", unique: false },
    ],
  },
];

export const worksphereOfflineRegistry: DatabaseMigrationDefinition = {
  dbName: "worksphere-offline",
  currentVersion: 9,
  requiredStores: WORKSPHERE_OFFLINE_REQUIRED_STORES,
  structuralMigrations: [
    {
      id: "worksphere-offline-v1-core",
      version: 1,
      description: "Initialize venues, favorites, searches, and pendingActions stores",
      upgrade: (db, tx) => {
        ensureStoreSchema(db, tx, WORKSPHERE_OFFLINE_REQUIRED_STORES[0]);
        ensureStoreSchema(db, tx, WORKSPHERE_OFFLINE_REQUIRED_STORES[1]);
        ensureStoreSchema(db, tx, WORKSPHERE_OFFLINE_REQUIRED_STORES[2]);
        ensureStoreSchema(db, tx, WORKSPHERE_OFFLINE_REQUIRED_STORES[3]);
      },
    },
    {
      id: "worksphere-offline-v2-image-lru",
      version: 2,
      description: "Add imageCacheLRU store for bounded image caching",
      upgrade: (db, tx) => {
        ensureStoreSchema(db, tx, WORKSPHERE_OFFLINE_REQUIRED_STORES[4]);
      },
    },
    {
      id: "worksphere-offline-v3-receipts",
      version: 3,
      description: "Add receiptExports store for offline receipt downloads",
      upgrade: (db, tx) => {
        ensureStoreSchema(db, tx, WORKSPHERE_OFFLINE_REQUIRED_STORES[5]);
      },
    },
    {
      id: "worksphere-offline-v4-favorites-cleanup",
      version: 4,
      description: "Add pendingFavorites and remove legacy pending-actions store",
      upgrade: (db, tx) => {
        if (db.objectStoreNames.contains("pending-actions")) {
          db.deleteObjectStore("pending-actions");
        }
        ensureStoreSchema(db, tx, WORKSPHERE_OFFLINE_REQUIRED_STORES[6]);
      },
    },
    {
      id: "worksphere-offline-v5-availability",
      version: 5,
      description: "Add availabilityDeltas store for periodic background sync",
      upgrade: (db, tx) => {
        ensureStoreSchema(db, tx, WORKSPHERE_OFFLINE_REQUIRED_STORES[7]);
      },
    },
    {
      id: "worksphere-offline-v6-recently-viewed",
      version: 6,
      description: "Add recentlyViewedVenues store",
      upgrade: (db, tx) => {
        ensureStoreSchema(db, tx, WORKSPHERE_OFFLINE_REQUIRED_STORES[8]);
      },
    },
    {
      id: "worksphere-offline-v7-reviews-and-rankings",
      version: 7,
      description: "Add pendingReviews, preference_rankings, queued_reviews, and unsyncedReviewDrafts",
      upgrade: (db, tx) => {
        ensureStoreSchema(db, tx, WORKSPHERE_OFFLINE_REQUIRED_STORES[9]);
        ensureStoreSchema(db, tx, WORKSPHERE_OFFLINE_REQUIRED_STORES[10]);
        ensureStoreSchema(db, tx, WORKSPHERE_OFFLINE_REQUIRED_STORES[11]);
        ensureStoreSchema(db, tx, WORKSPHERE_OFFLINE_REQUIRED_STORES[12]);
      },
    },
    {
      id: "worksphere-offline-v8-index-reconciliation",
      version: 8,
      description: "Reconcile review indexes across page and service worker schemas",
      upgrade: (db, tx) => {
        for (const spec of WORKSPHERE_OFFLINE_REQUIRED_STORES.slice(0, 13)) {
          ensureStoreSchema(db, tx, spec);
        }
      },
    },
    {
      id: "worksphere-offline-v9-pending-checkins",
      version: 9,
      description: "Add pendingCheckins store and reconcile all 14 shared stores",
      upgrade: (db, tx) => {
        for (const spec of WORKSPHERE_OFFLINE_REQUIRED_STORES) {
          ensureStoreSchema(db, tx, spec);
        }
      },
    },
  ],
  dataMigrations: [
    {
      id: "worksphere-offline-v9-compat-records",
      version: 9,
      description: "Normalize legacy queued reviews, check-ins, and receipts idempotently",
      storeNames: ["pendingReviews", "queued_reviews", "pendingCheckins", "receiptExports"],
      batchSize: 50,
      migrate: (ctx) =>
        runResumableStoreDataMigration(ctx, [
          "pendingReviews",
          "queued_reviews",
          "pendingCheckins",
          "receiptExports",
        ]),
    },
  ],
};

// ---------------------------------------------------------------------------
// 2. Secondary Offline Outbox Database: "WorkSphereOfflineDB" (Version 3)
// ---------------------------------------------------------------------------

export const WORKSPHERE_OFFLINE_DB_REQUIRED_STORES: StoreSchemaExpectation[] = [
  {
    name: "venues",
    keyPath: "id",
    indexes: [
      { name: "type", keyPath: "type", unique: false },
      { name: "savedAt", keyPath: "savedAt", unique: false },
    ],
  },
  {
    name: "favorites",
    keyPath: "id",
    indexes: [{ name: "savedAt", keyPath: "savedAt", unique: false }],
  },
  {
    name: "searches",
    keyPath: "query",
    indexes: [{ name: "timestamp", keyPath: "timestamp", unique: false }],
  },
  {
    name: "pending_sync_queue",
    keyPath: "id",
    indexes: [
      { name: "domain", keyPath: "domain", unique: false },
      { name: "status", keyPath: "status", unique: false },
      { name: "timestamp", keyPath: "timestamp", unique: false },
    ],
  },
  { name: "pendingActions", keyPath: "id", autoIncrement: true },
  {
    name: "receiptExports",
    keyPath: "bookingId",
    indexes: [
      { name: "status", keyPath: "status", unique: false },
      { name: "createdAt", keyPath: "createdAt", unique: false },
    ],
  },
  { name: "pendingFavorites", keyPath: "id" },
  { name: "preference_rankings", keyPath: "id" },
  {
    name: "recentlyViewedVenues",
    keyPath: "id",
    indexes: [{ name: "viewedAt", keyPath: "viewedAt", unique: false }],
  },
  {
    name: "pendingReviews",
    keyPath: "id",
    indexes: [
      { name: "venueId", keyPath: "venueId", unique: false },
      { name: "status", keyPath: "status", unique: false },
      { name: "createdAt", keyPath: "createdAt", unique: false },
    ],
  },
  {
    name: "pending_notes_queue",
    keyPath: "id",
    autoIncrement: true,
    indexes: [{ name: "by-folder", keyPath: "folderId", unique: false }],
  },
  { name: "notes_cache", keyPath: "folderId" },
  { name: "favorite_tags", keyPath: "id" },
  {
    name: "crdt_tombstones",
    keyPath: "id",
    indexes: [
      { name: "deletedAt", keyPath: "deletedAt", unique: false },
      { name: "isMerged", keyPath: "isMerged", unique: false },
    ],
  },
  { name: "favorites-outbox", keyPath: "id", autoIncrement: true },
  { name: "checkins-outbox", keyPath: "id", autoIncrement: true },
  { name: "favorite-tags-outbox", keyPath: "id", autoIncrement: true },
];

export const worksphereOfflineDbRegistry: DatabaseMigrationDefinition = {
  dbName: "WorkSphereOfflineDB",
  currentVersion: 3,
  requiredStores: WORKSPHERE_OFFLINE_DB_REQUIRED_STORES,
  structuralMigrations: [
    {
      id: "worksphere-offline-db-v1-core",
      version: 1,
      description: "Initialize core venues, searches, pending_sync_queue, and legacy outboxes",
      upgrade: (db, tx) => {
        for (const spec of WORKSPHERE_OFFLINE_DB_REQUIRED_STORES.slice(0, 6)) {
          ensureStoreSchema(db, tx, spec);
        }
        ensureStoreSchema(db, tx, WORKSPHERE_OFFLINE_DB_REQUIRED_STORES[14]);
        ensureStoreSchema(db, tx, WORKSPHERE_OFFLINE_DB_REQUIRED_STORES[15]);
      },
    },
    {
      id: "worksphere-offline-db-v2-reviews-and-tags",
      version: 2,
      description: "Add pendingFavorites, preference_rankings, recentlyViewedVenues, pendingReviews, and favorite-tags-outbox",
      upgrade: (db, tx) => {
        for (const spec of WORKSPHERE_OFFLINE_DB_REQUIRED_STORES.slice(6, 10)) {
          ensureStoreSchema(db, tx, spec);
        }
        ensureStoreSchema(db, tx, WORKSPHERE_OFFLINE_DB_REQUIRED_STORES[16]);
      },
    },
    {
      id: "worksphere-offline-db-v3-notes-and-crdt",
      version: 3,
      description: "Add notes stores, favorite_tags, crdt_tombstones, and reconcile all outbox stores",
      upgrade: (db, tx) => {
        for (const spec of WORKSPHERE_OFFLINE_DB_REQUIRED_STORES) {
          ensureStoreSchema(db, tx, spec);
        }
      },
    },
  ],
  dataMigrations: [
    {
      id: "worksphere-offline-db-v3-compat-records",
      version: 3,
      description: "Ensure legacy queue and outbox records remain compatible",
      storeNames: ["pending_sync_queue", "pendingReviews", "checkins-outbox"],
      batchSize: 50,
      migrate: (ctx) =>
        runResumableStoreDataMigration(ctx, [
          "pending_sync_queue",
          "pendingReviews",
          "checkins-outbox",
        ]),
    },
  ],
};

// ---------------------------------------------------------------------------
// 3. Booking Drafts Database: "WorkSphereBookingDB" (Version 2)
// ---------------------------------------------------------------------------

export const WORKSPHERE_BOOKING_REQUIRED_STORES: StoreSchemaExpectation[] = [
  {
    name: "booking_drafts",
    keyPath: "id",
    indexes: [
      { name: "venueId", keyPath: "venueId", unique: false },
      { name: "userId", keyPath: "userId", unique: false },
      { name: "updatedAt", keyPath: "updatedAt", unique: false },
    ],
  },
];

export const bookingDraftsDbRegistry: DatabaseMigrationDefinition = {
  dbName: "WorkSphereBookingDB",
  currentVersion: 2,
  requiredStores: WORKSPHERE_BOOKING_REQUIRED_STORES,
  structuralMigrations: [
    {
      id: "booking-db-v1-drafts-store",
      version: 1,
      description: "Create booking_drafts object store",
      upgrade: (db) => {
        if (!db.objectStoreNames.contains("booking_drafts")) {
          db.createObjectStore("booking_drafts", { keyPath: "id" });
        }
      },
    },
    {
      id: "booking-db-v2-draft-indexes",
      version: 2,
      description: "Add venueId, userId, and updatedAt indexes to booking_drafts",
      upgrade: (db, tx) => {
        ensureStoreSchema(db, tx, WORKSPHERE_BOOKING_REQUIRED_STORES[0]);
      },
    },
  ],
  dataMigrations: [
    {
      id: "booking-db-v2-preserve-encrypted-drafts",
      version: 2,
      description: "Adapt legacy booking drafts while preserving encrypted payloads and vector clocks",
      storeNames: ["booking_drafts"],
      batchSize: 50,
      migrate: (ctx) => runResumableStoreDataMigration(ctx, ["booking_drafts"]),
    },
  ],
};

// ---------------------------------------------------------------------------
// 4. Offline Mutations Database: "WorkSphereOfflineMutationsDB" (Version 2)
// ---------------------------------------------------------------------------

export const WORKSPHERE_OFFLINE_MUTATIONS_REQUIRED_STORES: StoreSchemaExpectation[] =
  [
    {
      name: "offline_mutations",
      keyPath: "id",
      indexes: [
        { name: "status", keyPath: "status", unique: false },
        { name: "timestamp", keyPath: "timestamp", unique: false },
      ],
    },
  ];

export const offlineMutationsDbRegistry: DatabaseMigrationDefinition = {
  dbName: "WorkSphereOfflineMutationsDB",
  currentVersion: 2,
  requiredStores: WORKSPHERE_OFFLINE_MUTATIONS_REQUIRED_STORES,
  structuralMigrations: [
    {
      id: "mutations-db-v1-store",
      version: 1,
      description: "Create offline_mutations object store",
      upgrade: (db) => {
        if (!db.objectStoreNames.contains("offline_mutations")) {
          db.createObjectStore("offline_mutations", { keyPath: "id" });
        }
      },
    },
    {
      id: "mutations-db-v2-indexes",
      version: 2,
      description: "Add status and timestamp indexes to offline_mutations",
      upgrade: (db, tx) => {
        ensureStoreSchema(
          db,
          tx,
          WORKSPHERE_OFFLINE_MUTATIONS_REQUIRED_STORES[0],
        );
      },
    },
  ],
  dataMigrations: [
    {
      id: "mutations-db-v2-compat-records",
      version: 2,
      description: "Adapt legacy offline mutations while preserving idempotency keys and completed states",
      storeNames: ["offline_mutations"],
      batchSize: 50,
      migrate: (ctx) =>
        runResumableStoreDataMigration(ctx, ["offline_mutations"]),
    },
  ],
};

// Register default registries
registries.set(worksphereOfflineRegistry.dbName, worksphereOfflineRegistry);
registries.set(worksphereOfflineDbRegistry.dbName, worksphereOfflineDbRegistry);
registries.set(bookingDraftsDbRegistry.dbName, bookingDraftsDbRegistry);
registries.set(
  offlineMutationsDbRegistry.dbName,
  offlineMutationsDbRegistry,
);

export function getMigrationRegistry(
  dbName: string,
): DatabaseMigrationDefinition | undefined {
  return registries.get(dbName);
}

export function registerDatabaseMigration(
  definition: DatabaseMigrationDefinition,
): void {
  registries.set(definition.dbName, definition);
}

export function listRegisteredDatabases(): DatabaseMigrationDefinition[] {
  return Array.from(registries.values());
}
