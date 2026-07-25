# Web Locks Serialization for Offline Writes

## Overview

WorkSphere uses IndexedDB for offline persistence. Multiple modules interact with offline data, including:

* `src/lib/offlineStore.ts`
* `src/lib/offlineStorage.ts`

These modules can perform writes to overlapping offline state. Because IndexedDB operations are asynchronous, concurrent read-modify-write operations can race with each other.

For example, two operations may both read the same state, independently modify it, and then write their results:

```text
Operation A                 Operation B
-----------                 -----------
Read state
                            Read state
Modify state
                            Modify state
Write state
                            Write state
```

The later write may overwrite changes made by the earlier operation. This is especially problematic for offline outbox data, where a concurrent write could silently remove an entry that another operation had already queued.

To prevent these races, the project uses a shared Web Locks API helper in:

```text
src/lib/webLock.ts
```

The helper exposes a shared lock name:

```ts
export const OFFLINE_WRITE_LOCK = "worksphere-offline-write-lock";
```

and the lock wrapper:

```ts
export async function withWebLock<T>(
  callback: () => Promise<T>,
  lockName: string = OFFLINE_WRITE_LOCK,
): Promise<T>
```

The shared helper ensures that cooperating offline write paths use the same synchronization mechanism.

The core rule is:

> Offline write operations that must serialize against one another must use the same lock name.

---

## Why a Shared Lock Is Required

The Web Lock is shared between offline modules rather than being defined independently in each file.

The intended relationship is:

```text
                    src/lib/webLock.ts
                            |
                            v
                  OFFLINE_WRITE_LOCK
                            |
              "worksphere-offline-write-lock"
                            |
                +-----------+-----------+
                |                       |
                v                       v
        offlineStore.ts         offlineStorage.ts
                |                       |
                +-----------+-----------+
                            |
                            v
                   Shared lock domain
```

If both modules used separate lock names, they would not coordinate:

```text
offlineStore.ts                 offlineStorage.ts
      |                                |
      v                                v
  Lock A                           Lock B
      |                                |
      +------- independent ------------+
              execution
```

The shared `OFFLINE_WRITE_LOCK` prevents this situation.

Both modules can request:

```text
worksphere-offline-write-lock
```

and therefore participate in the same lock domain.

This is important when both modules can modify overlapping favorite state or related offline outbox data.

---

# Web Locks Concurrency Guarantees

## Lock Acquisition

When Web Locks are available, `withWebLock` calls:

```ts
return navigator.locks.request(lockName, async () => callback());
```

The callback is therefore executed through the browser's Web Locks API.

For two operations using the same lock name:

```text
Operation A
    |
    +-- Request worksphere-offline-write-lock
    |
    +-- Lock acquired
    |
    +-- Execute callback
    |
    +-- Callback completes
    |
    +-- Lock released
                |
                v
Operation B
    |
    +-- Request worksphere-offline-write-lock
    |
    +-- Waits until lock is available
    |
    +-- Lock acquired
    |
    +-- Execute callback
```

The important guarantee is that cooperating callbacks using the same named lock do not execute their protected critical sections concurrently.

The application should rely on this for mutual exclusion, not on a particular ordering of requests.

---

## What Is Protected

The callback passed to `withWebLock` defines the protected critical section.

A complete read-modify-write sequence should be inside the callback:

```ts
await withWebLock(async () => {
  const current = await readState();
  const updated = modifyState(current);

  await writeState(updated);
});
```

This allows the read, modification, and write to be serialized as one operation.

The following pattern does not provide the same guarantee:

```ts
const current = await readState();

await withWebLock(async () => {
  const updated = modifyState(current);

  await writeState(updated);
});
```

The read occurs before the lock is acquired. Another operation could modify the state between the initial read and lock acquisition.

Therefore:

> Any read-modify-write sequence that depends on serialized state access should be performed inside the `withWebLock` callback.

---

## What Is Not Protected

The Web Lock does not automatically protect every IndexedDB operation in the application.

Only operations that explicitly call `withWebLock` participate in the lock.

For example:

```ts
await withWebLock(async () => {
  await protectedWrite();
});
```

is coordinated.

An unrelated operation such as:

```ts
await unprotectedWrite();
```

does not automatically wait for the lock.

When adding a new offline write path, developers should determine whether it can modify state that is also accessed by existing locked operations.

If serialization is required, the new operation should use the shared helper and the appropriate lock name.

---

## Lock Names Define Synchronization Domains

Web Locks are identified by their names.

The default lock used by WorkSphere is:

```text
worksphere-offline-write-lock
```

Operations requesting this name participate in the same lock domain.

Different names create separate lock domains:

```text
worksphere-offline-write-lock
```

and:

```text
some-other-lock
```

do not coordinate with each other.

Therefore, a new lock name should only be introduced when the operation intentionally belongs to a separate synchronization domain.

For offline writes that must coordinate with existing offline state, the default `OFFLINE_WRITE_LOCK` should be used.

---

## Cross-Tab Concurrency

Browser tabs run in separate JavaScript execution contexts.

A normal in-memory JavaScript mutex cannot reliably coordinate operations between tabs.

The Web Locks API provides browser-level coordination for cooperating contexts using the same lock name.

For example:

```text
Browser
|
+-- Tab A
|     |
|     +-- offlineStore.ts
|
+-- Tab B
      |
      +-- offlineStorage.ts
```

If both tabs request:

```text
worksphere-offline-write-lock
```

the operations participate in the same lock domain when Web Locks are supported.

Conceptually:

```text
Tab A                         Tab B
-----                         -----
Request shared lock           Request shared lock
       |                             |
       +-------------+---------------+
                     |
                     v
              Same lock name
                     |
                     v
              One callback
              at a time
```

This is the key mechanism for preventing concurrent offline writes from different tabs from entering their protected critical sections simultaneously.

The same principle applies when two different modules request the shared lock.

---

## Lock Lifetime

The asynchronous callback defines the lifetime of the protected operation.

Conceptually:

```text
Lock requested
      |
      v
Lock acquired
      |
      v
Callback starts
      |
      |  Protected asynchronous work
      |
      v
Callback resolves or rejects
      |
      v
Lock request completes
```

The callback may contain asynchronous operations:

```ts
await withWebLock(async () => {
  await firstOperation();
  await secondOperation();
  await thirdOperation();
});
```

The protected operation should therefore include all asynchronous work that must be serialized.

---

# Web Locks API Fallback Behaviour

## Capability Detection

Before requesting a lock, `withWebLock` checks whether the Web Locks API is available:

```ts
const hasLocksApi =
  typeof navigator !== "undefined" &&
  "locks" in navigator &&
  !!navigator.locks?.request;
```

The check verifies:

1. `navigator` exists.
2. `navigator.locks` exists.
3. `navigator.locks.request` is available.

This also prevents the helper from directly accessing an undefined `navigator` in environments such as server-side rendering or some test environments.

---

## Unsupported Web Locks API

When the Web Locks API is unavailable, the helper executes:

```ts
if (!hasLocksApi) {
  return callback();
}
```

The callback therefore runs directly without acquiring a Web Lock.

The behaviour is:

```text
Web Locks API available?
          |
      +---+---+
      |       |
     Yes      No
      |       |
      v       v
 Request    Execute
 named      callback
 lock       directly
```

This fallback allows the operation to continue in environments that do not provide the Web Locks API.

However, it does **not** provide an equivalent cross-tab serialization mechanism.

Therefore, when `navigator.locks` is unsupported:

* The callback still executes.
* No Web Lock is acquired.
* The operation does not fail solely because Web Locks are unavailable.
* The Web Locks-based mutual exclusion guarantee is unavailable.
* Concurrent operations may execute without cross-tab serialization.

The fallback is intentional and should be understood as a compatibility path.

---

## Fallback Is Not Error Recovery

The direct callback path is only used when the environment does not support the required Web Locks API capability.

It is not an error recovery mechanism.

The helper does **not** use this pattern:

```ts
try {
  return await navigator.locks.request(lockName, callback);
} catch {
  return callback();
}
```

That implementation would be unsafe because the `catch` block could also catch an error thrown by the callback itself.

The callback could then execute a second time without the lock.

The current implementation has only one intentional unlocked path:

```ts
if (!hasLocksApi) {
  return callback();
}
```

Therefore:

> An unsupported Web Locks API results in direct callback execution. A callback failure does not result in an unlocked retry.

---

# Error Propagation and Retry Safety

## Callback Errors Propagate

The Web Locks path intentionally does not wrap the lock request in a broad `try/catch`.

The implementation is:

```ts
return navigator.locks.request(lockName, async () => callback());
```

If the callback throws or rejects, the error propagates to the caller.

For example:

```ts
await withWebLock(async () => {
  throw new Error("Offline write failed");
});
```

The caller receives the failure.

The helper does not:

* Swallow the callback error.
* Treat the callback error as a Web Locks API failure.
* Execute the callback a second time.
* Retry the callback outside the lock.

This behaviour is intentional.

---

## Why Unlocked Retries Are Dangerous

Consider an incorrect implementation:

```ts
try {
  return await navigator.locks.request(lockName, callback);
} catch {
  return callback();
}
```

The following sequence could occur:

```text
1. Lock acquired
2. Callback starts
3. Offline write fails
4. Callback rejects
5. catch block executes
6. Callback runs again
7. Second execution occurs without the lock
```

The second execution bypasses serialization.

This is especially dangerous for read-modify-write operations because another tab or module may enter the same operation at the same time.

The failure therefore creates exactly the race condition that the lock was intended to prevent.

The current implementation avoids this by allowing the callback error to propagate normally.

The intended flow is:

```text
Lock acquired
      |
      v
Callback executes
      |
      v
Callback fails
      |
      v
Error propagates to caller
      |
      v
No automatic unlocked retry
```

---

## No Automatic Retry

`withWebLock` does not retry failed callbacks.

If higher-level code needs to retry an operation, the retry must preserve the synchronization boundary.

A safe conceptual pattern is:

```ts
await retry(async () => {
  return withWebLock(async () => {
    await performOfflineWrite();
  });
});
```

Each retry requests the lock again.

An unsafe pattern is:

```ts
try {
  await withWebLock(async () => {
    await performOfflineWrite();
  });
} catch {
  await performOfflineWrite();
}
```

The second call bypasses the lock.

Therefore:

> Any retry of a lock-protected operation must re-enter through `withWebLock`.

The lock helper intentionally leaves retry policy to its caller.

---

## Error Propagation Flow

The expected behaviour is:

```text
Caller
   |
   v
withWebLock(callback)
   |
   v
Request named lock
   |
   v
Lock acquired
   |
   v
callback()
   |
   +------------+
   |            |
Success       Error
   |            |
   v            v
Return       Propagate
result       error
```

There is no automatic path from a callback failure to an unlocked second invocation.

This prevents failed operations from silently bypassing the synchronization mechanism.

---

# Manual Testing

The following tests verify the Web Locks behaviour in a real browser.

The tests cover:

* Concurrent writes from multiple tabs.
* Shared locking across modules.
* Rapid concurrent writes.
* Lock contention.
* Error propagation.
* Prevention of unlocked retries.
* Unsupported Web Locks fallback.

---

## Test Environment

For the primary tests, use a browser that supports the Web Locks API.

Prepare the environment:

1. Start the WorkSphere frontend.
2. Open the application in Tab A.
3. Open the same application in Tab B.
4. Ensure both tabs use the same origin.
5. Open Developer Tools.
6. Keep the Console available.
7. Identify application actions that trigger offline writes.

The same-origin requirement is important because the Web Locks API coordinates cooperating contexts within the relevant origin.

---

## Test 1: Concurrent Writes From Two Tabs

### Objective

Verify that concurrent offline writes from two tabs use the shared lock.

### Steps

1. Open WorkSphere in Tab A.
2. Open WorkSphere in Tab B.
3. Put the application into the appropriate offline state.
4. Trigger an offline write in Tab A.
5. Immediately trigger another offline write in Tab B.
6. Repeat the test several times.
7. Perform the actions rapidly to increase contention.
8. Inspect the resulting offline state and outbox data.

### Expected Result

Both operations should participate in:

```text
worksphere-offline-write-lock
```

The protected critical sections should not execute concurrently.

Previously queued outbox entries should not be silently removed because of a concurrent read-modify-write race.

The exact order in which operations acquire the lock may vary. The important result is that the protected callbacks do not overlap.

---

## Test 2: Rapid Multi-Tab Writes

### Objective

Stress-test the lock with several writes from multiple tabs.

### Steps

1. Open the application in Tab A.
2. Open the same application in Tab B.
3. Trigger several offline writes rapidly in Tab A.
4. At approximately the same time, trigger several offline writes in Tab B.
5. Repeat the process several times.
6. Inspect the final offline state.
7. Inspect IndexedDB records if necessary.

### Expected Result

Cooperating writes should be serialized.

The resulting offline state should contain the expected successfully completed changes.

Previously queued outbox entries should not disappear solely because another tab performed a concurrent write.

---

## Test 3: Cross-Module Concurrent Writes

### Objective

Verify that `offlineStore.ts` and `offlineStorage.ts` use the same lock domain.

### Steps

1. Identify an action that uses the `offlineStore.ts` write path.
2. Identify an action that uses the `offlineStorage.ts` write path.
3. Open the application in two tabs.
4. Trigger the `offlineStore.ts` operation in Tab A.
5. Immediately trigger the `offlineStorage.ts` operation in Tab B.
6. Repeat the test rapidly.

### Expected Result

Both operations should use:

```text
OFFLINE_WRITE_LOCK
```

with the default lock name:

```text
worksphere-offline-write-lock
```

The operations should therefore coordinate with each other rather than using independent lock queues.

---

## Test 4: Verify Lock Contention With Temporary Logging

### Objective

Make serialized execution visible in the browser console.

In a development-only change, temporarily add logging around a protected operation:

```ts
await withWebLock(async () => {
  console.log("WRITE START", Date.now());

  await performWrite();

  console.log("WRITE END", Date.now());
});
```

### Steps

1. Add temporary logging to the relevant development code.
2. Open the application in two tabs.
3. Trigger writes in both tabs at nearly the same time.
4. Observe the console output.
5. Repeat several times.

### Expected Result

The logs should show one protected operation completing before the other begins.

For example:

```text
Tab A: WRITE START
Tab A: WRITE END
Tab B: WRITE START
Tab B: WRITE END
```

or:

```text
Tab B: WRITE START
Tab B: WRITE END
Tab A: WRITE START
Tab A: WRITE END
```

The exact order is not important.

The following pattern would indicate that the protected sections are overlapping:

```text
Tab A: WRITE START
Tab B: WRITE START
Tab A: WRITE END
Tab B: WRITE END
```

If overlapping execution is observed, verify:

* Both operations use `withWebLock`.
* Both operations use the same lock name.
* The Web Locks API is available.
* The complete critical section is inside the callback.

Remove temporary logging after testing.

---

## Test 5: Callback Error Propagation

### Objective

Verify that a callback error propagates without causing a second unlocked execution.

In a development-only environment, temporarily use:

```ts
await withWebLock(async () => {
  console.log("CALLBACK EXECUTED");
  throw new Error("Intentional test failure");
});
```

### Steps

1. Trigger the operation.
2. Observe the browser console.
3. Count the number of `CALLBACK EXECUTED` messages.
4. Confirm that the error reaches the caller.

### Expected Result

The callback should execute once:

```text
CALLBACK EXECUTED
Error: Intentional test failure
```

There should not be a second execution:

```text
CALLBACK EXECUTED
Error: Intentional test failure
CALLBACK EXECUTED
```

The second execution would indicate an unsafe retry path outside the lock.

---

## Test 6: Failed Write Does Not Bypass the Lock

### Objective

Verify that a failed callback is not executed again without synchronization.

### Steps

1. Open the application in two tabs.
2. Temporarily make a protected callback fail in Tab A.
3. Trigger the operation in Tab A.
4. Immediately trigger a corresponding operation in Tab B.
5. Observe the console logs.

### Expected Result

Tab A should receive the callback error.

The failed callback should not automatically execute a second time without the lock.

Tab B should still be able to acquire the lock after Tab A's lock request completes.

The failure must not create an unlocked retry path.

---

## Test 7: Unsupported Web Locks API Fallback

### Objective

Verify behaviour when `navigator.locks` is unavailable.

### Steps

Use a controlled test or development environment where the Web Locks API is unavailable.

The capability check should evaluate to false:

```ts
const hasLocksApi =
  typeof navigator !== "undefined" &&
  "locks" in navigator &&
  !!navigator.locks?.request;
```

Trigger an operation that uses `withWebLock`.

### Expected Result

The callback should still execute through:

```ts
return callback();
```

No Web Lock should be requested.

The behaviour is:

```text
Web Locks unavailable
        |
        v
Callback executes directly
```

This confirms that the fallback is based on capability detection.

It should not be confused with a failed lock request followed by an unlocked retry.

---

## Test 8: Inspect IndexedDB After Concurrent Writes

### Objective

Verify that concurrent writes do not silently drop outbox entries.

### Steps

1. Open browser Developer Tools.
2. Open the Application or Storage panel.
3. Locate IndexedDB for the WorkSphere origin.
4. Identify the relevant offline stores.
5. Open WorkSphere in two tabs.
6. Trigger multiple offline writes from both tabs.
7. Inspect the resulting IndexedDB records.
8. Compare the records against the operations performed.

### Expected Result

The stored data should contain the expected successfully completed writes.

Previously queued outbox entries should not disappear solely because another tab performed a concurrent write.

Any intentionally failed operation should follow the application's normal error-handling behaviour.

---

# Troubleshooting

## Writes Appear to Overlap

Check:

1. Is the Web Locks API available?
2. Are both operations using `withWebLock`?
3. Are both operations using `OFFLINE_WRITE_LOCK`?
4. Is the entire read-modify-write sequence inside the callback?
5. Does any code path bypass the shared helper?
6. Is a different custom lock name being passed?

---

## One Module Does Not Wait for Another

Verify that both modules ultimately request:

```text
worksphere-offline-write-lock
```

Different lock names create different synchronization domains.

For example:

```text
worksphere-offline-write-lock
```

and:

```text
offline-storage-lock
```

do not coordinate.

Use the shared `OFFLINE_WRITE_LOCK` for operations that need to serialize with the existing offline write paths.

---

## Callback Appears to Execute Twice

The `withWebLock` helper does not automatically retry callbacks.

Search higher-level code for patterns such as:

```ts
try {
  await withWebLock(...);
} catch {
  await performWrite();
}
```

or:

```ts
try {
  await withWebLock(...);
} catch {
  await callback();
}
```

These patterns can create an unlocked retry.

Any retry should re-enter through `withWebLock`.

---

## Writes Work in One Tab but Race Across Tabs

Check whether the Web Locks API is available.

A single tab may appear to work because operations are less likely to overlap.

Use the multi-tab tests in this document to verify cross-tab behaviour.

If the Web Locks API is unavailable, the helper intentionally executes the callback directly and cannot provide the same Web Locks-based cross-tab serialization guarantee.

---

# Developer Guidelines

When adding or modifying offline write paths:

### Use the shared helper

Use:

```ts
await withWebLock(async () => {
  // IndexedDB read-modify-write operation
});
```

Do not create another independent Web Locks helper.

### Use the shared lock

For operations that must coordinate with existing offline writes, use:

```ts
OFFLINE_WRITE_LOCK
```

or rely on the default `lockName` parameter.

### Protect the complete operation

If the operation is:

```text
Read
  |
Modify
  |
Write
```

and those steps must be serialized, keep all of them inside the lock callback.

### Do not add unlocked retries

Avoid:

```ts
try {
  await withWebLock(...);
} catch {
  await performWrite();
}
```

The retry bypasses the synchronization mechanism.

### Preserve error propagation

Allow callback errors to propagate to the caller unless there is a deliberate higher-level error-handling policy.

### Retry through the lock

If a higher-level operation needs retries, each attempt must re-enter through `withWebLock`.

---

# Design Invariants

The implementation relies on these invariants:

1. **One shared lock domain**
   Cooperating offline write paths use `worksphere-offline-write-lock`.

2. **Centralized implementation**
   Web Lock acquisition is handled by `src/lib/webLock.ts`.

3. **Capability-based fallback**
   When Web Locks are unavailable, the helper executes the callback directly.

4. **No unlocked error retry**
   A callback error propagates to the caller and does not trigger a second unlocked execution.

5. **No automatic retry**
   `withWebLock` does not retry failed callbacks.

6. **Complete critical sections**
   Work that must be serialized belongs inside the callback.

7. **Consistent lock names**
   Operations using different lock names do not share the same synchronization domain.

---

# Summary

`src/lib/webLock.ts` provides a centralized Web Locks API wrapper for serializing cooperating offline write operations.

The shared lock is:

```text
worksphere-offline-write-lock
```

It allows `offlineStore.ts` and `offlineStorage.ts` to coordinate operations that may affect overlapping offline state.

When Web Locks are supported:

```text
Request shared lock
        |
        v
Lock acquired
        |
        v
Run callback
        |
        +--------+
        |        |
     Success   Error
        |        |
        v        v
     Return   Propagate
     result    error
```

When Web Locks are unavailable:

```text
Web Locks unsupported
        |
        v
Execute callback directly
```

This fallback is a capability fallback, not an error-recovery mechanism.

The implementation intentionally avoids catching callback failures and retrying them outside the lock. This prevents the exact race condition that the shared lock is designed to prevent.

The key rule is:

> Never turn a callback failure into an unlocked retry.

When changing the offline write system, ensure that:

* Related write paths use `withWebLock`.
* Operations that need to serialize use the same lock name.
* Complete read-modify-write sequences are inside the callback.
* Callback errors propagate normally.
* Retries re-enter through `withWebLock`.
* New lock names are introduced only for intentionally separate synchronization domains.

The manual multi-tab tests in this document should be used to verify that the serialization boundary remains effective and that concurrent offline writes do not silently overwrite or remove previously queued state.
