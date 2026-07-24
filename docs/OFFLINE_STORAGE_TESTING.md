# Offline Storage Testing Guide

This guide provides step-by-step instructions for inspecting, clearing, and testing the offline database (IndexedDB) in WorkSphere using browser Developer Tools.

## 1. Inspecting IndexedDB Tables in DevTools

You can view the raw data stored in your local offline database directly from your browser.

### In Google Chrome / Edge

1. Open the Developer Tools by pressing `F12` or `Ctrl + Shift + I` (`Cmd + Option + I` on macOS).
2. Navigate to the **Application** tab at the top.
3. In the left sidebar, expand the **Storage** section, then expand **IndexedDB**.
4. Click on the WorkSphere database (e.g., `worksphere-offline-db`).
5. You will see a list of object stores (tables). Click on any table to view its stored records in the main pane.
6. To refresh the data, click the **Refresh** icon above the data table.

### In Mozilla Firefox

1. Open the Developer Tools by pressing `F12` or `Ctrl + Shift + I` (`Cmd + Option + I` on macOS).
2. Navigate to the **Storage** tab at the top.
3. In the left sidebar, expand the **Indexed DB** section.
4. Expand the WorkSphere database origin (e.g., `http://localhost:3000`).
5. Click on the database name to reveal the object stores.
6. Click on a specific store to inspect the key-value entries.

---

## 2. Clearing the Offline Database Store

If you need to reset your local environment or clear corrupted data, you can clear the database entirely.

### Option A: Using DevTools (UI)

1. Open the **Application** tab (Chrome) or **Storage** tab (Firefox).
2. Navigate to **Storage > IndexedDB** and click on the specific database.
3. Click the **Delete database** button at the top of the viewing pane.

### Option B: Using Code / Console

You can clear specific object stores programmatically. Run the following snippet in the browser console, or integrate it into your test setup:

```javascript
/**
 * Clears all data from a specific IndexedDB store.
 * @param {string} dbName - The name of the database.
 * @param {string} storeName - The name of the object store to clear.
 */
function clearOfflineStore(dbName, storeName) {
  const request = indexedDB.open(dbName);

  request.onsuccess = (event) => {
    const db = event.target.result;
    const transaction = db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);

    const clearRequest = store.clear();

    clearRequest.onsuccess = () => {
      console.log(`Successfully cleared the '${storeName}' store.`);
    };

    clearRequest.onerror = (err) => {
      console.error(`Failed to clear store:`, err);
    };
  };

  request.onerror = (err) => {
    console.error(`Failed to open database:`, err);
  };
}

// Example usage:
// clearOfflineStore('worksphere-offline-db', 'venues');
```

---

## 3. Simulating Network Disconnection

Testing offline capabilities requires simulating a loss of network connectivity.

### In Chrome / Edge

1. Open the Developer Tools (`F12`).
2. Navigate to the **Network** tab.
3. Locate the throttling dropdown (usually says "No throttling" by default).
4. Select **Offline** from the dropdown menu.
5. A warning icon will appear on the Network tab, indicating that the browser is now simulating an offline state. All network requests will fail, triggering the service worker and offline IndexedDB fallbacks.

### In Firefox

1. Open the Developer Tools (`F12`).
2. Navigate to the **Network** tab.
3. Locate the throttling dropdown (default is "No throttling").
4. Select **Offline**.

---

## 4. IndexedDB Schema Migration Playbook

WorkSphere uses two IndexedDB databases that evolve independently:

| Database | Module | Current Version |
| :--- | :--- | :---: |
| `worksphere-offline` | `src/lib/offlineStorage.ts` | 4 |
| `WorkSphereOfflineDB` | `src/lib/offlineStore.ts` | 3 |

When you bump `DB_VERSION` (or the version argument to `indexedDB.open()`), the browser fires `IDBOpenDBRequest.onupgradeneeded` **before** `onsuccess`. This is the only place where you are allowed to create, delete, or modify object stores and indexes.

### 4.1 How `onupgradeneeded` Works

```
indexedDB.open(DB_NAME, newVersion)
         │
         ▼
  ┌──────────────┐     version unchanged     ┌───────────┐
  │ Version Check ├────────────────────────▶  │ onsuccess │
  └──────┬───────┘                            └───────────┘
         │ newVersion > oldVersion
         ▼
  ┌──────────────────┐
  │ onupgradeneeded  │  ◀── The ONLY place to modify schema
  │ (event)          │
  │  • event.oldVersion  — version the user's browser currently has
  │  • event.newVersion  — the version you are opening
  └──────┬───────────┘
         │ completes without error
         ▼
  ┌───────────┐
  │ onsuccess │
  └───────────┘
```

**Critical rules:**
- `createObjectStore()`, `deleteObjectStore()`, `createIndex()`, and `deleteIndex()` can **only** be called inside the `onupgradeneeded` callback.
- The upgrade runs inside an implicit `versionchange` transaction — you do not need to call `db.transaction()`.
- If the callback throws, the entire upgrade is rolled back and `onerror` fires instead of `onsuccess`.

### 4.2 The WorkSphere `onupgradeneeded` Pattern

Both modules use a **guard-check** pattern — wrapping each `createObjectStore` call in a `db.objectStoreNames.contains()` check. This means the handler is safe to re-run at any version; it only creates stores that are missing.

```typescript
// From src/lib/offlineStorage.ts
request.onupgradeneeded = (event) => {
  const database = (event.target as IDBOpenDBRequest).result;

  // Guard: only create if the store doesn't already exist
  if (!database.objectStoreNames.contains("venues")) {
    const venuesStore = database.createObjectStore("venues", {
      keyPath: "id",
    });
    venuesStore.createIndex("type", "type", { unique: false });
    venuesStore.createIndex("savedAt", "savedAt", { unique: false });
  }

  if (!database.objectStoreNames.contains("favorites")) {
    const favoritesStore = database.createObjectStore("favorites", {
      keyPath: "id",
    });
    favoritesStore.createIndex("savedAt", "savedAt", { unique: false });
  }

  // ... additional stores follow the same pattern
};
```

### 4.3 Handling `onblocked` and `onversionchange`

When one tab opens a higher version while another tab still holds an active connection, the upgrade cannot proceed until the old connection closes. WorkSphere handles this with two complementary callbacks:

```typescript
// On the NEW tab (requesting the upgrade):
request.onblocked = () => {
  console.warn("[OfflineDB] Database upgrade blocked — another tab holds the connection");
};

// On the OLD tab (holding the stale connection):
db.onversionchange = () => {
  db.close();
  dbInstance = null;
  dbPromise = null;
  // The stale connection is released so the upgrade can proceed
};
```

> **Always register `onversionchange`** on every opened connection. If you forget, upgrades will block indefinitely when users have multiple tabs open.

---

## 5. Index Creation and Versioning Upgrade Strategies

### 5.1 Adding a New Object Store

When adding a new store (e.g., a `conversations` outbox), follow these steps:

1. **Bump the version constant** in the relevant module:
   ```typescript
   // src/lib/offlineStorage.ts
   const DB_VERSION = 5; // was 4
   ```

2. **Add the guarded creation** inside `onupgradeneeded`:
   ```typescript
   if (!database.objectStoreNames.contains("conversations")) {
     const store = database.createObjectStore("conversations", {
       keyPath: "id",
       autoIncrement: true,
     });
     store.createIndex("timestamp", "timestamp", { unique: false });
   }
   ```

3. **No data loss** — existing stores remain intact because the guard checks ensure they are not recreated or dropped.

### 5.2 Adding an Index to an Existing Store

Adding an index to a store that already exists requires accessing it via the `versionchange` transaction:

1. **Bump the version.**
2. **Access the existing store** from the upgrade transaction, then call `createIndex()`:

   ```typescript
   request.onupgradeneeded = (event) => {
     const database = (event.target as IDBOpenDBRequest).result;
     const tx = (event.target as IDBOpenDBRequest).transaction!;

     // Create new stores as usual...
     if (!database.objectStoreNames.contains("venues")) {
       // ... full creation
     }

     // Add an index to an existing store
     if (database.objectStoreNames.contains("venues")) {
       const venuesStore = tx.objectStore("venues");
       if (!venuesStore.indexNames.contains("category")) {
         venuesStore.createIndex("category", "category", { unique: false });
       }
     }
   };
   ```

   > **Key point:** Use `tx.objectStore("venues")` (from the upgrade transaction), not `database.transaction("venues")`. The implicit `versionchange` transaction is the only transaction where schema modifications are allowed.

### 5.3 Renaming / Replacing an Object Store

IndexedDB does not support renaming stores. To migrate data from an old store to a new one:

1. **Read all records** from the old store using the `versionchange` transaction.
2. **Create the new store** with the updated schema.
3. **Re-insert records** into the new store, transforming them as needed.
4. **Delete the old store.**

```typescript
request.onupgradeneeded = (event) => {
  const database = (event.target as IDBOpenDBRequest).result;
  const tx = (event.target as IDBOpenDBRequest).transaction!;

  if (database.objectStoreNames.contains("pending-actions")) {
    // Step 1: Read existing data
    const oldStore = tx.objectStore("pending-actions");
    const getAllRequest = oldStore.getAll();

    getAllRequest.onsuccess = () => {
      const records = getAllRequest.result;

      // Step 2: Delete old store
      database.deleteObjectStore("pending-actions");

      // Step 3: Create new store with updated schema
      const newStore = database.createObjectStore("pendingActions", {
        keyPath: "id",
        autoIncrement: true,
      });

      // Step 4: Re-insert migrated records
      for (const record of records) {
        newStore.add({
          ...record,
          migratedAt: Date.now(),
        });
      }
    };
  }
};
```

### 5.4 Stepped Version Upgrades

For users who skip multiple versions (e.g., they haven't opened the app since version 2 and you are now on version 5), use `event.oldVersion` to run migrations incrementally:

```typescript
request.onupgradeneeded = (event) => {
  const database = (event.target as IDBOpenDBRequest).result;
  const oldVersion = event.oldVersion;

  if (oldVersion < 2) {
    // v1 → v2: add favorites store
    database.createObjectStore("favorites", { keyPath: "id" });
  }

  if (oldVersion < 3) {
    // v2 → v3: add searches store with timestamp index
    const searchesStore = database.createObjectStore("searches", {
      keyPath: "query",
    });
    searchesStore.createIndex("timestamp", "timestamp", { unique: false });
  }

  if (oldVersion < 4) {
    // v3 → v4: add receiptExports store
    const receiptStore = database.createObjectStore("receiptExports", {
      keyPath: "bookingId",
    });
    receiptStore.createIndex("status", "status", { unique: false });
    receiptStore.createIndex("createdAt", "createdAt", { unique: false });
  }

  if (oldVersion < 5) {
    // v4 → v5: add index to existing venues store
    const tx = (event.target as IDBOpenDBRequest).transaction!;
    const venuesStore = tx.objectStore("venues");
    if (!venuesStore.indexNames.contains("category")) {
      venuesStore.createIndex("category", "category", { unique: false });
    }
  }
};
```

> **Why stepped upgrades?** A user on version 1 upgrading to version 5 will run all four `if` blocks in sequence within a single `versionchange` transaction. This ensures every intermediate migration is applied.

---

## 6. Test Guidelines for Simulating Legacy Store Migrations

### 6.1 Setting Up `fake-indexeddb` for Jest

WorkSphere uses [`fake-indexeddb`](https://github.com/nicolo-ribaudo/fake-indexeddb) to provide a full IndexedDB implementation in Node.js for unit tests. Import it at the top of your test file:

```typescript
import "fake-indexeddb/auto";
```

This globally polyfills `indexedDB`, `IDBDatabase`, `IDBTransaction`, and related classes. The polyfill supports `onupgradeneeded`, versioning, and all store/index operations.

### 6.2 Clearing the Database Between Tests

Each test should start with a clean database to prevent cross-test contamination:

```typescript
afterEach(async () => {
  // Delete the database entirely so the next test triggers a fresh onupgradeneeded
  const req = indexedDB.deleteDatabase("worksphere-offline");
  await new Promise<void>((resolve) => {
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
  });
});
```

Alternatively, use `jest.resetModules()` to clear the cached singleton `dbInstance`:

```typescript
beforeEach(() => {
  jest.resetModules();
});
```

### 6.3 Simulating a Legacy Store Migration

To test that your `onupgradeneeded` correctly migrates data from an older schema version to a newer one:

**Step 1: Pre-seed a legacy database at the old version.**

```typescript
it("migrates data from v2 to v3 without data loss", async () => {
  // Step 1: Create a v2 database with legacy data
  const legacyDb = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("worksphere-offline", 2);
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      // v2 schema: only venues and favorites
      if (!db.objectStoreNames.contains("venues")) {
        db.createObjectStore("venues", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("favorites")) {
        db.createObjectStore("favorites", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  // Insert test data into the legacy store
  await new Promise<void>((resolve, reject) => {
    const tx = legacyDb.transaction("venues", "readwrite");
    tx.objectStore("venues").add({ id: "v1", name: "Legacy Venue" });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  // Close the legacy connection so the upgrade can proceed
  legacyDb.close();

  // Step 2: Re-open at the new version — triggers onupgradeneeded
  const upgradedDb = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("worksphere-offline", 4); // new version
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      // Your production onupgradeneeded handler goes here
      if (!db.objectStoreNames.contains("searches")) {
        const s = db.createObjectStore("searches", { keyPath: "query" });
        s.createIndex("timestamp", "timestamp", { unique: false });
      }
      if (!db.objectStoreNames.contains("pendingActions")) {
        db.createObjectStore("pendingActions", {
          keyPath: "id",
          autoIncrement: true,
        });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  // Step 3: Verify legacy data survived the upgrade
  const legacyVenue = await new Promise<any>((resolve, reject) => {
    const tx = upgradedDb.transaction("venues", "readonly");
    const req = tx.objectStore("venues").get("v1");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  expect(legacyVenue).toBeDefined();
  expect(legacyVenue.name).toBe("Legacy Venue");

  // Step 4: Verify new stores were created
  expect(upgradedDb.objectStoreNames.contains("searches")).toBe(true);
  expect(upgradedDb.objectStoreNames.contains("pendingActions")).toBe(true);

  upgradedDb.close();
});
```

### 6.4 Testing the `onblocked` Scenario

To verify that multi-tab upgrade blocking is handled correctly:

```typescript
it("handles blocked upgrades gracefully", async () => {
  // Open at current version and do NOT close the connection
  const oldDb = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("worksphere-offline", 3);
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("venues")) {
        db.createObjectStore("venues", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  // Register the versionchange handler (as production code does)
  const versionChangeFired = new Promise<void>((resolve) => {
    oldDb.onversionchange = () => {
      oldDb.close();
      resolve();
    };
  });

  // Now open at a higher version — this will be blocked until oldDb closes
  const upgradePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("worksphere-offline", 4);
    req.onblocked = () => {
      // In production, log a warning here
    };
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("pendingActions")) {
        db.createObjectStore("pendingActions", {
          keyPath: "id",
          autoIncrement: true,
        });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  // The versionchange event should have fired on the old connection
  await versionChangeFired;

  // The upgrade should now complete
  const newDb = await upgradePromise;
  expect(newDb.version).toBe(4);
  expect(newDb.objectStoreNames.contains("pendingActions")).toBe(true);

  newDb.close();
});
```

### 6.5 Testing `SecurityError` (Safari Private Browsing)

The existing tests in `offlineStore.test.ts` demonstrate how to mock `indexedDB.open` to throw a `SecurityError`:

```typescript
it("gracefully intercepts SecurityError and alerts user once", async () => {
  const originalOpen = indexedDB.open;
  indexedDB.open = jest.fn().mockImplementation(() => {
    const err = new Error("SecurityError: access blocked");
    err.name = "SecurityError";
    throw err;
  });

  // The module should not crash — it catches the error and shows an alert
  await expect(queueOfflineFavorite("venue-fail", "ADD")).resolves.toBeUndefined();
  expect(global.alert).toHaveBeenCalledTimes(1);

  indexedDB.open = originalOpen;
});
```

---

## 7. Migration Checklist

Use this checklist when adding or modifying IndexedDB object stores:

- [ ] **Bump `DB_VERSION`** (or the version argument) in the relevant module.
- [ ] **Wrap new stores** in `!db.objectStoreNames.contains()` guards.
- [ ] **Wrap new indexes** in `!store.indexNames.contains()` guards.
- [ ] **Access existing stores** via `transaction.objectStore()` (from the `versionchange` transaction), not via `db.transaction()`.
- [ ] **Consider stepped upgrades** using `event.oldVersion` for users who skip multiple versions.
- [ ] **Register `onversionchange`** on every `onsuccess` to support multi-tab upgrades.
- [ ] **Register `onblocked`** to log warnings when upgrades are blocked by other tabs.
- [ ] **Write a migration test** that pre-seeds data at the old version, re-opens at the new version, and verifies data survival.
- [ ] **Run `jest.resetModules()`** in test setup to clear singleton `dbInstance` caches between tests.
- [ ] **Test with `fake-indexeddb/auto`** to validate the full `onupgradeneeded` flow in CI.

---

## Further Reading

- [MDN — Using IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB)
- [MDN — IDBOpenDBRequest.onupgradeneeded](https://developer.mozilla.org/en-US/docs/Web/API/IDBOpenDBRequest/upgradeneeded_event)
- [WorkSphere — Offline IndexedDB Strategy](./OFFLINE_INDEXEDDB_STRATEGY.md)
- [WorkSphere — Background Sync Debug](./BACKGROUND_SYNC_DEBUG.md)
