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
 *
 * Fix for #2118:
 *  - The timeout fallback was calling the callback without a lock, defeating
 *    mutual exclusion. The timeout path now rejects with LockTimeoutError so
 *    callers can handle contention without ever running the critical section
 *    outside of a held lock.
 */

/** Thrown when withWebLock cannot acquire the lock within the timeout period. */
export class LockTimeoutError extends Error {
  readonly lockName: string;
  constructor(lockName: string, timeoutMs: number) {
    super(
      `Could not acquire lock "${lockName}" within ${timeoutMs}ms. The critical section was NOT executed.`,
    );
    this.name = "LockTimeoutError";
    this.lockName = lockName;
    // Maintain correct prototype chain for instanceof checks across transpile targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export const OFFLINE_WRITE_LOCK = "worksphere-offline-write-lock";

export async function withWebLock<T>(
  callback: () => Promise<T>,
  lockName: string = OFFLINE_WRITE_LOCK,
  timeoutMs: number = 5000,
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

  const controller = new AbortController();

  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      // Abort the pending lock request so the browser drops it from the
      // queue. The callback is intentionally NOT invoked here — running
      // the critical section without holding the lock defeats serialization.
      controller.abort();
      reject(new LockTimeoutError(lockName, timeoutMs));
    }, timeoutMs);

    navigator.locks
      .request(lockName, { signal: controller.signal }, async () => {
        clearTimeout(timeoutId);
        return callback();
      })
      .then(resolve)
      .catch((err: unknown) => {
        clearTimeout(timeoutId);
        // AbortError is the expected outcome of the timeout path above;
        // the caller already received a LockTimeoutError rejection, so
        // swallow this secondary rejection to avoid an unhandled-rejection
        // warning in the browser console.
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        reject(err);
      });
  });
}
