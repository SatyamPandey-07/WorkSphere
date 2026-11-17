# IndexedDB Migration and Sync Queue Troubleshooting

WorkSphere keeps offline data in an IndexedDB database. When that database cannot be opened (a schema version conflict, a blocked upgrade, a slow browser, private browsing), offline features switch to a temporary in-memory queue. This guide explains what happens in each case, what the messages mean, and how to recover.

For the overall design see [indexeddb-sync-architecture.md](./indexeddb-sync-architecture.md).

## Where things live

| Part                                                                                    | File                                            |
| :-------------------------------------------------------------------------------------- | :---------------------------------------------- |
| Opening and upgrading the database: `initOfflineDB()`, `resetOfflineDBNonDestructive()` | `src/lib/offline/db.ts`                         |
| Offline sync queue with in-memory fallback: `SyncQueueManager`                          | `src/lib/offline/SyncQueueManager.ts`           |
| Storage panel with the reset button                                                     | `src/components/offline/StorageStatsDrawer.tsx` |

| Setting        | Value                                                                    |
| :------------- | :----------------------------------------------------------------------- |
| Database name  | `WorkSphereOfflineDB` (`OFFLINE_DB_NAME`)                                |
| Schema version | `3` (`OFFLINE_DB_VERSION`)                                               |
| Open timeout   | 4000 ms (`DEFAULT_DB_OPEN_TIMEOUT_MS`)                                   |
| Queue store    | `pending_sync_queue` (key `id`, indexes `domain`, `status`, `timestamp`) |

## How `initOfflineDB()` opens the database

1. Outside a browser (`indexedDB` undefined) it rejects with `Error("IndexedDB is not available on server-side")`.
2. It reuses an open connection, or an open that is already in progress, so the database is opened once per page.
3. It calls `indexedDB.open("WorkSphereOfflineDB", 3)` and starts a 4-second timer.
4. `onupgradeneeded` creates any object store that does not exist yet. Existing stores are never changed or deleted, so upgrading from an older version keeps its data.
5. On success it keeps the connection and closes it again when another tab asks for a newer version (`onversionchange`).

Every failure **rejects**; `initOfflineDB()` never falls back by itself. The fallback is done by its callers, such as `SyncQueueManager`.

## Error catalog

| Error (name and message)                                                          | When it happens                                                                                                                                                                        | Console message                                                                         |
| :-------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------- |
| `VersionError`: "The requested version (3) is less than the existing version (N)" | The browser has a newer schema than this build, for example after switching back from a newer deployment or branch.                                                                    | `[OfflineDB] Schema VersionError detected; falling back gracefully`                     |
| `VersionError`: "IndexedDB upgrade blocked by another open connection"            | Another tab still has the old version open and did not close it, so the upgrade is blocked. `initOfflineDB` reports this as a `VersionError` too.                                      | `[OfflineDB] Database version upgrade blocked by open connection, closing stale handle` |
| `TimeoutError`: "IndexedDB open timed out after 4000ms"                           | The browser did not answer within 4 seconds (busy disk, very large database, a stuck upgrade).                                                                                         | `[OfflineDB] IndexedDB open timed out:`                                                 |
| `SecurityError`                                                                   | Storage is blocked, for example Safari Private Browsing or site data blocked in the browser settings. An alert explains that offline features are disabled; it is shown once per page. | none besides the alert                                                                  |
| `InvalidStateError` / `UnknownError`                                              | Some browsers in private mode or with a corrupted profile.                                                                                                                             | none; the error is passed on                                                            |
| `Error`: "IndexedDB is not available on server-side"                              | Code ran during server rendering.                                                                                                                                                      | none                                                                                    |

During an upgrade, problems inside the upgrade transaction are logged as `[OfflineDB] Upgrade transaction aborted` or `[OfflineDB] Upgrade transaction error`.

## The in-memory fallback in `SyncQueueManager`

When a queue operation cannot open or write to the database, `SyncQueueManager`:

1. keeps the item in an in-memory map instead;
2. logs `[SyncQueueManager] Offline database upgrade failed; switched to temporary in-memory sync queue.`;
3. shows that message once as a warning toast, through the handler passed as `onWarningToast`, or else by dispatching a `worksphere:toast` window event;
4. reports `isUsingInMemoryFallback() === true`.

While the fallback is active:

- `getQueue()` returns the in-memory items; when the database works again it returns the stored and in-memory items together.
- `syncAll()` / `processQueue()` still sends queued items to their handlers when the browser is online. A sync runs on the `online` event and when another tab posts `SYNC_TRIGGERED` on the `worksphere:sync-queue-channel` BroadcastChannel.
- **In-memory items exist only in this tab.** Closing or reloading the tab before they sync loses them.

The next successful write to IndexedDB switches the flag back to `false`.

An item whose handler fails is retried on the next sync. After 5 failed attempts (`DEFAULT_MAX_RETRIES`) it is removed from the queue and a warning is logged: `Max retries (5) exceeded for item …`.

## The non-destructive reset

The storage panel (`StorageStatsDrawer`) has a **Repair & Reset Offline Database** section with a **Reset DB Safely** button. It calls `SyncQueueManager.resetDatabaseNonDestructive()`, which runs `resetOfflineDBNonDestructive()`:

1. Close this tab's connection.
2. Read the items stored in `pending_sync_queue`. The database is opened at its current version, so this also works when the stored schema is newer than the build.
3. Add the in-memory fallback items; an item in both places is kept once, from memory.
4. Delete `WorkSphereOfflineDB`.
5. Create it again at version 3 and put the pending items back.
6. Clear the in-memory queue and the fallback flag.

The panel then shows "Offline database reset cleanly (N pending items preserved)."

**What the reset does not keep.** Only `pending_sync_queue` is restored. Every other store is emptied: cached venues, favorites, search history, recently viewed venues, receipt exports, pending favorites and reviews, notes caches, favorite tags, preference rankings and CRDT tombstones. Cached data is fetched again when you are online, but anything pending in those other stores is lost, so sync first when you can.

Steps 2 and 3 were added in #7913. Before that change only in-memory items were restored, and pending items stored in IndexedDB were deleted.

## Recovery workflows

**Toast "switched to temporary in-memory sync queue"**

1. Keep the tab open and online so pending items can sync.
2. Close other WorkSphere tabs: an old tab holding the database open is the most common cause of a blocked upgrade.
3. Reload. If the warning is gone, the database opened normally.
4. If it comes back, open the storage panel and press **Reset DB Safely**.

**`VersionError` after switching branches or deployments**

The stored schema is newer than the code you are running. Press **Reset DB Safely**, or during development delete the database in DevTools (Application > Storage > IndexedDB > `WorkSphereOfflineDB` > Delete database) after syncing.

**Repeated `TimeoutError`**

Check free disk space and the storage estimate in the panel. A very large cache can make the first open slow; resetting clears the caches.

## Private and incognito browsing

| Browser                  | Behaviour                                                                                                 |
| :----------------------- | :-------------------------------------------------------------------------------------------------------- |
| Safari, Private Browsing | Opening the database fails with `SecurityError`; WorkSphere shows an alert and offline features stay off. |
| Chrome / Edge, Incognito | IndexedDB works but is deleted when the window closes, and the storage quota is smaller.                  |
| Firefox, Private Window  | Recent versions keep IndexedDB in memory for the session; older versions fail with `InvalidStateError`.   |

Diagnostic steps:

1. Check the console for the messages in the error catalog above.
2. In DevTools, open Application > Storage > IndexedDB and check whether `WorkSphereOfflineDB` exists and which version it has.
3. In the console, run `await navigator.storage.estimate()` to see usage and quota, and `await navigator.storage.persisted()` to see whether the browser may evict the data.
4. Check whether site data is blocked for the site in the browser settings.
5. Try a normal window. If it works there, the restriction comes from the private mode.

## For developers

- Do not change or remove an existing store in `onupgradeneeded`; add new stores with an `objectStoreNames.contains` check, as the existing code does, and raise `OFFLINE_DB_VERSION`.
- Callers of `initOfflineDB()` must handle a rejected promise; it does not fall back on its own.
- To simulate a failure in a test, mock `initOfflineDB` to reject with `new DOMException("…", "VersionError")`; see `src/__tests__/offline/indexeddbMigrationFallback.test.ts`. `fake-indexeddb` is loaded in `jest.setup.js` for tests that need a real database.
