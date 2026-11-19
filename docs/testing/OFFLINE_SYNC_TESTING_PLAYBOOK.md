# Offline sync and IndexedDB fallback testing playbook

This guide covers the offline sync state machine implemented by
`src/lib/offline/SyncQueueManager.ts`, storage UI behavior in
`src/components/offline/StorageStatsDrawer.tsx`, and browser persistence
fallbacks. It is intended for Jest component/unit tests and Playwright
end-to-end tests.

## Test boundaries

| Layer | What to verify | Preferred tool |
| --- | --- | --- |
| Queue manager | enqueue, retries, backoff, handler failure, replay and fallback | Jest |
| IndexedDB adapter | open/upgrade errors, blocked upgrades, quota failures and transaction cleanup | Jest + fake-indexeddb |
| React storage UI | progress, confirmation, success/error announcements and unmount safety | React Testing Library |
| Browser behavior | online/offline transitions, multiple tabs and real browser IndexedDB behavior | Playwright |

Keep most state-machine scenarios deterministic in Jest. Reserve Playwright for
browser APIs and end-to-end wiring that a DOM mock cannot faithfully model.

## Jest setup and isolation

Use fake timers only for the test that needs to advance retry/backoff time.
Restore real timers and mocks after each test. Reset the queue manager's
in-memory state between cases; do not let a module-level singleton or a
BroadcastChannel listener leak into another test.

Example setup:

```ts
beforeEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});
```

When a test needs retry timing, opt into fake timers inside that test and
advance only the expected delay:

```ts
jest.useFakeTimers();
const syncPromise = manager.syncAll();
await jest.advanceTimersByTimeAsync(1_000);
await syncPromise;
jest.useRealTimers();
```

Prefer injected queue handlers, storage adapters, clocks, and warning callbacks
when the class exposes them. Avoid mocking the whole queue manager when the
behavior under test is the queue manager itself.

## IndexedDB failure recipes

The application uses IndexedDB-backed offline stores and the `idb` wrapper.
Use the repository's `fake-indexeddb` dependency for deterministic unit tests.
A test can install the fake implementation before importing a module that opens
a database:

```ts
import "fake-indexeddb/auto";
```

### VersionError

Simulate a database that was created with a newer schema version, then attempt
to open it with an older requested version. Assert that the adapter reports a
recoverable storage error, does not delete user data, and does not start a
second write against a partially opened database.

### QuotaExceededError

Make the write transaction reject with a `QuotaExceededError`. Assert that
the failed item remains recoverable or is surfaced as an explicit failure;
never mark it as synchronized merely because the network request succeeded.
Also verify that the UI presents a useful message and releases loading state.

### Blocked upgrade

Open the same database from a second connection, then request a version
upgrade. Keep the first connection alive to trigger `onblocked`; close it and
verify that the upgrade can finish. Tests must close every database connection
in `afterEach` so a blocked-upgrade test cannot hang later cases.

Example transaction assertions should verify both the rejection path and
cleanup path. Avoid relying on a fixed wall-clock timeout when a test can
await the request/transaction event directly.

## Online/offline transitions

For a Jest component test, override the read-only `navigator.onLine` property
through `Object.defineProperty` and dispatch the browser event:

```ts
Object.defineProperty(window.navigator, "onLine", {
  configurable: true,
  value: false,
});
window.dispatchEvent(new Event("offline"));

Object.defineProperty(window.navigator, "onLine", {
  configurable: true,
  value: true,
});
window.dispatchEvent(new Event("online"));
```

Restore the original property descriptor after the test. Assert that offline
items remain queued while offline and that the registered handler is invoked
when the online event triggers synchronization. If a component subscribes to
`window` events, unmount it and verify the listener is removed.

## Web Locks and multi-tab coordination

Mock `navigator.locks.request` at the boundary rather than trying to emulate
the browser's internal lock scheduler in every unit test. Cover:

- lock granted immediately;
- lock callback delayed while another owner holds it;
- request rejected or unavailable, exercising the fallback path;
- two operations requesting the same lock name;
- lock cleanup after an exception.

For real multi-tab behavior, use two Playwright pages in the same browser
context and have both request the same named lock. Assert that critical writes
do not overlap and that both pages eventually complete.

## StorageStatsDrawer component checks

The component fetches storage stats, stale-cache stats and pending check-ins
when opened. Cover the following scenarios:

1. Initial loading state and populated initial stats.
2. Stale-cache purge confirmation; cancel must not call the purge function.
3. Successful purge updates the success status and refreshed stats.
4. Purge rejection leaves the drawer usable and exposes an error message.
5. Cache-clear confirmation warns about unsynced check-ins.
6. A delayed operation resolving after unmount must not update component state.
7. Success and error messages are announced using their intended status roles.

Use the existing test at
`src/__tests__/components/offline/StorageStatsDrawer.test.tsx` as the
reference for mocks of offline storage, check-in queue and sync manager.

## Playwright end-to-end scenarios

Use a fresh browser context per test so IndexedDB, Cache Storage, service-worker
registrations, and local storage do not leak across tests.

Recommended scenarios:

- Start online, enqueue an operation, go offline, reload, and verify that the
  queued operation remains persisted.
- Return online and verify that the queue drains exactly once.
- Simulate an IndexedDB upgrade while another page has the database open.
- Clear the offline cache through the confirmation dialog and verify the UI
  returns to an empty storage state.
- Close the storage drawer while a storage read or purge is pending and verify
  that there are no uncaught errors.

When testing storage cleanup, do not erase unrelated browser state such as
authentication cookies unless the scenario explicitly covers signed-out users.

## CI and resource-leak diagnostics

Run focused tests first, then the full suite:

```bash
npm test -- --runInBand src/__tests__/components/offline/StorageStatsDrawer.test.tsx
npm test -- --runInBand
```

For Jest projects configured with the corresponding CLI, use
`--detectOpenHandles` to investigate leaked timers, BroadcastChannels,
database connections and event listeners. Treat it as a diagnostic tool, not
as a replacement for closing resources explicitly.

For Playwright, use the repository's configured Playwright script and retain
the HTML report and trace for a failed test. Do not add an arbitrary new CI
workflow solely for this guide; document and use the project's existing test
commands.

## Review checklist

- [ ] IndexedDB connections close on success, failure and test teardown.
- [ ] Timers are advanced deterministically and restored.
- [ ] Online/offline listeners and BroadcastChannels are cleaned up.
- [ ] Failed writes are not silently reported as synced.
- [ ] Tests preserve queued work when storage is unavailable.
- [ ] Playwright contexts are isolated between scenarios.

## Reproducible blocked-upgrade browser test

The following Playwright snippet holds version 1 of a database open in one page, requests version 2 from another page, observes `blocked`, then closes the first connection and waits for the upgrade to finish. It can be placed in a browser test using the existing `page` fixture:

```ts
const result = await page.evaluate(async () => {
  const databaseName = `worksphere-blocked-upgrade-${Date.now()}`;
  const firstOpen = indexedDB.open(databaseName, 1);
  const firstDb = await new Promise<IDBDatabase>((resolve, reject) => {
    firstOpen.onsuccess = () => resolve(firstOpen.result);
    firstOpen.onerror = () => reject(firstOpen.error);
  });

  const upgrade = indexedDB.open(databaseName, 2);
  const sawBlocked = await new Promise<boolean>((resolve, reject) => {
    const timeout = window.setTimeout(() => resolve(false), 2_000);
    upgrade.onblocked = () => {
      window.clearTimeout(timeout);
      resolve(true);
    };
    upgrade.onerror = () => {
      window.clearTimeout(timeout);
      reject(upgrade.error);
    };
  });

  firstDb.close();
  const upgradedDb = await new Promise<IDBDatabase>((resolve, reject) => {
    upgrade.onsuccess = () => resolve(upgrade.result);
    upgrade.onerror = () => reject(upgrade.error);
  });
  upgradedDb.close();
  await new Promise<void>((resolve, reject) => {
    const deletion = indexedDB.deleteDatabase(databaseName);
    deletion.onsuccess = () => resolve();
    deletion.onerror = () => reject(deletion.error);
  });
  return sawBlocked;
});

expect(result).toBe(true);
```

The timeout bounds a broken test rather than asserting that a fixed delay is the browser's upgrade behavior. Always close both connections and delete the temporary database, including in a test teardown if an assertion fails.
