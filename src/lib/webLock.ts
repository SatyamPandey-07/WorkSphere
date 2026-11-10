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

export class LockTimeoutError extends Error {
  readonly lockName: string;
  readonly timeoutMs: number;

  constructor(lockName: string, timeoutMs: number = 5000) {
    super(`Could not acquire lock "${lockName}" within ${timeoutMs}ms. The critical section was NOT executed.`);
    this.name = "LockTimeoutError";
    this.lockName = lockName;
    this.timeoutMs = timeoutMs;
  }
}

export interface WebLockOptions {
  timeoutMs?: number;
  fallbackOnTimeout?: boolean;
}

export async function withWebLock<T>(
  callback: () => Promise<T>,
  lockName: string = OFFLINE_WRITE_LOCK,
  options?: WebLockOptions | number,
): Promise<T> {
  const parsedTimeout =
    typeof options === "number"
      ? options
      : typeof options === "object" && typeof options?.timeoutMs === "number"
      ? options.timeoutMs
      : 5000;

  const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout >= 0 ? parsedTimeout : 5000;
  const fallbackOnTimeout = typeof options === "object" && Boolean(options?.fallbackOnTimeout);

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

  let executed = false;

  const runOnce = async (): Promise<T> => {
    if (executed) {
      return undefined as unknown as T;
    }
    executed = true;
    return callback();
  };

  return new Promise<T>((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout>;
    let timedOut = false;

    const lockPromise = navigator.locks.request(lockName, async () => {
      if (timedOut) return undefined as unknown as T;
      clearTimeout(timeoutId);
      return runOnce();
    });

    const timeoutPromise = new Promise<T>((_, timeoutReject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        timeoutReject(new Error("LOCK_TIMEOUT"));
      }, timeoutMs);
    });

    Promise.race([lockPromise, timeoutPromise])
      .then(resolve)
      .catch((err) => {
        if (err instanceof Error && err.message === "LOCK_TIMEOUT") {
          if (fallbackOnTimeout) {
            runOnce().then(resolve).catch(reject);
          } else {
            // Running the callback without a lock would defeat serialization —
            // exactly the scenario Web Locks are supposed to prevent.
            // Reject instead so the caller can surface the error and retry if needed.
            reject(new LockTimeoutError(lockName, timeoutMs));
          }
        } else {
          reject(err);
        }
      })
      .finally(() => {
        clearTimeout(timeoutId);
      });
  });
}
