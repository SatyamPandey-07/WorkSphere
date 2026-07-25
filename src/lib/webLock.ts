/**
 * Single shared Web Locks helper used by ALL IndexedDB-touching modules
 * (offlineStore.ts, offlineStorage.ts) so they serialize against each
 * other, not just against themselves.
 *
 * Fix for #829:
 *  - Previously each file had its OWN copy of this function with its own
 *    lock name, so writes in offlineStore.ts never waited on writes in
 *    offlineStorage.ts even though both touch overlapping favorite state.
 *  - Previously, if the locked callback threw, the surrounding try/catch
 *    treated that as "the Locks API itself failed" and re-ran the callback
 *    a SECOND time with no lock at all — silently defeating serialization
 *    on exactly the call that most needed it (the one that errored).
 *    That unlocked retry is what let rapid concurrent writes interleave
 *    and silently drop earlier queued outbox entries.
 */

export const OFFLINE_WRITE_LOCK = "worksphere-offline-write-lock";

export async function withWebLock<T>(
  callback: () => Promise<T>,
  lockName: string = OFFLINE_WRITE_LOCK,
): Promise<T> {
  const hasLocksApi =
    typeof navigator !== "undefined" &&
    "locks" in navigator &&
    !!navigator.locks?.request;

  if (!hasLocksApi) {
    // No Web Locks API support — nothing to
    // serialize against, so just run it. This is the ONLY unlocked path,
    // and it's a capability fallback, not an error-recovery fallback.
    return callback();
  }

  // No try/catch here: if `callback` throws, that rejection should
  // propagate to the caller as-is. Swallowing it and re-running the
  // callback outside the lock reintroduces the exact race we're fixing.
  return navigator.locks.request(lockName, async () => callback());
}
