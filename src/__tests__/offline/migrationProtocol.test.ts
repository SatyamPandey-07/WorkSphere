import "fake-indexeddb/auto";
import {
  openDatabaseWithMigration,
  closeAllManagedConnections,
  getMigrationDiagnostics,
  loadMigrationCheckpoint,
} from "@/lib/offline/migrationCoordinator";
import {
  registerDatabaseMigration,
  DatabaseMigrationDefinition,
} from "@/lib/offline/migrations/migrationRegistry";

describe("IndexedDB Multi-Context Migration Protocol (#10169)", () => {
  beforeEach(() => {
    closeAllManagedConnections();
  });

  afterEach(() => {
    closeAllManagedConnections();
  });

  it("should open database and execute structural migrations up to current version", async () => {
    const dbName = "test-mig-protocol-1";
    const definition: DatabaseMigrationDefinition = {
      dbName,
      currentVersion: 1,
      requiredStores: [
        {
          name: "items",
          keyPath: "id",
          indexes: [{ name: "name", keyPath: "name", unique: false }],
        },
      ],
      structuralMigrations: [
        {
          id: "step-1",
          version: 1,
          description: "create items store",
          upgrade: (db) => {
            const store = db.createObjectStore("items", { keyPath: "id" });
            store.createIndex("name", "name", { unique: false });
          },
        },
      ],
      dataMigrations: [],
    };
    registerDatabaseMigration(definition);

    const db = await openDatabaseWithMigration(definition, { targetVersion: 1 });
    expect(db.version).toBe(1);
    expect(db.objectStoreNames.contains("items")).toBe(true);
    db.close();
  });

  it("should incrementally upgrade schema across versions while preserving records", async () => {
    const dbName = "test-mig-protocol-2";
    const v1Def: DatabaseMigrationDefinition = {
      dbName,
      currentVersion: 1,
      requiredStores: [
        {
          name: "records",
          keyPath: "id",
        },
      ],
      structuralMigrations: [
        {
          id: "rec-v1",
          version: 1,
          description: "create records store",
          upgrade: (db) => {
            db.createObjectStore("records", { keyPath: "id" });
          },
        },
      ],
      dataMigrations: [],
    };
    registerDatabaseMigration(v1Def);

    const db1 = await openDatabaseWithMigration(v1Def, { targetVersion: 1 });
    await new Promise<void>((resolve, reject) => {
      const tx = db1.transaction("records", "readwrite");
      const store = tx.objectStore("records");
      store.add({ id: "rec_alpha", title: "Original Title", count: 10 });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db1.close();

    const v2Def: DatabaseMigrationDefinition = {
      dbName,
      currentVersion: 2,
      requiredStores: [
        {
          name: "records",
          keyPath: "id",
        },
        {
          name: "audit_log",
          keyPath: "logId",
        },
      ],
      structuralMigrations: [
        {
          id: "rec-v1",
          version: 1,
          description: "create records store",
          upgrade: (db) => {
            if (!db.objectStoreNames.contains("records")) {
              db.createObjectStore("records", { keyPath: "id" });
            }
          },
        },
        {
          id: "rec-v2",
          version: 2,
          description: "add audit_log store",
          upgrade: (db) => {
            if (!db.objectStoreNames.contains("audit_log")) {
              db.createObjectStore("audit_log", { keyPath: "logId" });
            }
          },
        },
      ],
      dataMigrations: [],
    };
    registerDatabaseMigration(v2Def);

    const db2 = await openDatabaseWithMigration(v2Def, { targetVersion: 2 });
    expect(db2.version).toBe(2);
    expect(db2.objectStoreNames.contains("records")).toBe(true);
    expect(db2.objectStoreNames.contains("audit_log")).toBe(true);

    const retrieved = await new Promise<any>((resolve, reject) => {
      const tx = db2.transaction("records", "readonly");
      const store = tx.objectStore("records");
      const req = store.get("rec_alpha");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    expect(retrieved).toBeDefined();
    expect(retrieved.title).toBe("Original Title");
    expect(retrieved.count).toBe(10);
    db2.close();
  });

  it("should track durable checkpoints and diagnostic events during migration", async () => {
    const dbName = "test-mig-protocol-3";
    const definition: DatabaseMigrationDefinition = {
      dbName,
      currentVersion: 1,
      requiredStores: [
        {
          name: "events",
          keyPath: "id",
        },
      ],
      structuralMigrations: [
        {
          id: "events-v1",
          version: 1,
          description: "create events store",
          upgrade: (db) => {
            db.createObjectStore("events", { keyPath: "id" });
          },
        },
      ],
      dataMigrations: [],
    };
    registerDatabaseMigration(definition);

    const db = await openDatabaseWithMigration(definition, { targetVersion: 1 });
    expect(db.version).toBe(1);

    const checkpoint = await loadMigrationCheckpoint(dbName);
    expect(checkpoint).toBeDefined();
    expect(checkpoint?.phase).toBe("COMPLETED");
    expect(checkpoint?.appliedVersion).toBe(1);

    const diagnostics = await getMigrationDiagnostics(dbName);
    expect(diagnostics.checkpoint).toBeDefined();
    expect(diagnostics.recentEvents.length).toBeGreaterThan(0);
    const completedEvent = diagnostics.recentEvents.find(
      (e) => e.dbName === dbName && e.phase === "COMPLETED"
    );
    expect(completedEvent).toBeDefined();
    db.close();
  });

  it("should handle versionchange by closing stale connection to unblock upgrade", async () => {
    const dbName = "test-mig-protocol-4";
    const v1Def: DatabaseMigrationDefinition = {
      dbName,
      currentVersion: 1,
      requiredStores: [{ name: "store_v1", keyPath: "id" }],
      structuralMigrations: [
        {
          id: "step-v1",
          version: 1,
          description: "init v1",
          upgrade: (db) => {
            db.createObjectStore("store_v1", { keyPath: "id" });
          },
        },
      ],
      dataMigrations: [],
    };
    registerDatabaseMigration(v1Def);

    // Open connection 1 (simulates open tab)
    const conn1 = await openDatabaseWithMigration(v1Def, { targetVersion: 1 });
    expect(conn1.version).toBe(1);

    const v2Def: DatabaseMigrationDefinition = {
      dbName,
      currentVersion: 2,
      requiredStores: [
        { name: "store_v1", keyPath: "id" },
        { name: "store_v2", keyPath: "id" },
      ],
      structuralMigrations: [
        {
          id: "step-v1",
          version: 1,
          description: "init v1",
          upgrade: (db) => {
            if (!db.objectStoreNames.contains("store_v1")) {
              db.createObjectStore("store_v1", { keyPath: "id" });
            }
          },
        },
        {
          id: "step-v2",
          version: 2,
          description: "add v2 store",
          upgrade: (db) => {
            if (!db.objectStoreNames.contains("store_v2")) {
              db.createObjectStore("store_v2", { keyPath: "id" });
            }
          },
        },
      ],
      dataMigrations: [],
    };
    registerDatabaseMigration(v2Def);

    // Opening connection 2 triggers upgrade; conn1 receives versionchange and yields
    const conn2 = await openDatabaseWithMigration(v2Def, { targetVersion: 2 });
    expect(conn2.version).toBe(2);
    expect(conn2.objectStoreNames.contains("store_v2")).toBe(true);
    conn2.close();
  });
});
