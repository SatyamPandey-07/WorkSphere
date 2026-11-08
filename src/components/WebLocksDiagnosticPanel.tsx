"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Lock,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Contrast,
} from "lucide-react";
import { OFFLINE_WRITE_LOCK } from "@/lib/webLock";
import { getQueuedFavorites, getQueuedCheckIns } from "@/lib/offlineStore";

interface LockState {
  held: boolean;
  pending: number;
}

interface OutboxState {
  favorites: number;
  checkIns: number;
}

/**
 * Wraps an IndexedDB write transaction in a Promise resolving strictly on `transaction.oncomplete`.
 * Rejects on `transaction.onerror` or `transaction.onabort`.
 */
export function wrapIdbTransaction<T = void>(
  tx: IDBTransaction,
  result?: T,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    tx.oncomplete = () => {
      resolve(result as T);
    };
    tx.onerror = () => {
      reject(tx.error || new Error("IDBTransaction error"));
    };
    tx.onabort = () => {
      reject(tx.error || new Error("IDBTransaction aborted"));
    };
  });
}

/**
 * Executes an IndexedDB write operation synchronized across tabs via the Web Locks API (`navigator.locks.request`).
 * Wraps the IDB write transaction in a Promise resolving strictly on `transaction.oncomplete`
 * and ensures the Web Lock callback awaits this Promise before releasing lock ownership.
 *
 * This prevents competing tabs from acquiring the lock prematurely while a write transaction
 * is still committing to disk, eliminating dirty reads.
 */
export async function executeSynchronizedWrite<T = void>(
  dbOrLockName: IDBDatabase | string,
  storeNamesOrCallback:
    | string
    | string[]
    | ((
        tx?: IDBTransaction,
      ) => Promise<IDBTransaction | T | void> | IDBTransaction | T | void),
  operation?: (tx: IDBTransaction) => Promise<T> | T | void,
  lockName: string = OFFLINE_WRITE_LOCK,
): Promise<T | void> {
  // Overload: executeSynchronizedWrite(lockName, callback)
  if (typeof dbOrLockName === "string") {
    const targetLock = dbOrLockName;
    const callback = storeNamesOrCallback as () =>
      Promise<IDBTransaction | T | void> | IDBTransaction | T | void;

    const execute = async () => {
      const outcome = await callback();
      if (outcome && typeof outcome === "object" && "oncomplete" in outcome) {
        await wrapIdbTransaction(outcome as unknown as IDBTransaction);
      }
      return outcome as T;
    };

    if (
      typeof navigator === "undefined" ||
      !("locks" in navigator) ||
      !navigator.locks?.request
    ) {
      return await execute();
    }

    return await navigator.locks.request(targetLock, async () => {
      return await execute();
    });
  }

  // Standard overload: executeSynchronizedWrite(db, storeNames, operation, lockName)
  const db = dbOrLockName;
  const storeNames = storeNamesOrCallback as string | string[];
  const op = operation || (() => {});
  const targetLock = lockName;

  const runTransaction = async (): Promise<T> => {
    const tx = db.transaction(storeNames, "readwrite");
    const completionPromise = wrapIdbTransaction<T>(tx);
    const result = await Promise.resolve(op(tx));
    // Await explicit resolution of transaction.oncomplete before lock callback resolves
    await completionPromise;
    return result as T;
  };

  if (
    typeof navigator === "undefined" ||
    !("locks" in navigator) ||
    !navigator.locks?.request
  ) {
    return await runTransaction();
  }

  return await navigator.locks.request(targetLock, async () => {
    return await runTransaction();
  });
}

export const performSynchronizedWrite = executeSynchronizedWrite;
export const synchronizedIdbWrite = executeSynchronizedWrite;

export function WebLocksDiagnosticPanel() {
  const [lockState, setLockState] = useState<LockState>({
    held: false,
    pending: 0,
  });
  const [outbox, setOutbox] = useState<OutboxState>({
    favorites: 0,
    checkIns: 0,
  });
  const [isSupported, setIsSupported] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isWriting, setIsWriting] = useState(false);
  const [highContrast, setHighContrast] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      // Check Web Locks API support safely
      const supported =
        typeof navigator !== "undefined" &&
        "locks" in navigator &&
        !!navigator.locks &&
        typeof navigator.locks.query === "function";
      setIsSupported(supported);

      if (supported) {
        const snapshot = await navigator.locks.query();
        const held =
          snapshot.held?.some(
            (l: { name?: string }) => l.name === OFFLINE_WRITE_LOCK,
          ) ?? false;
        const pending =
          snapshot.pending?.filter(
            (l: { name?: string }) => l.name === OFFLINE_WRITE_LOCK,
          ).length ?? 0;
        setLockState({ held, pending });
      }

      // Load IndexedDB outbox counts
      const [favorites, checkIns] = await Promise.all([
        getQueuedFavorites().then((q) => q.length),
        getQueuedCheckIns().then((q) => q.length),
      ]);
      setOutbox({ favorites, checkIns });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const forceReleaseLock = () => {
    if (typeof navigator === "undefined" || !navigator.locks?.request) return;
    // Acquire then immediately release the lock to flush any stuck holder
    navigator.locks.request(
      OFFLINE_WRITE_LOCK,
      { steal: true },
      async () => void 0,
    );
    setTimeout(refresh, 300);
  };

  const handleSynchronizedWriteTest = async () => {
    if (typeof navigator === "undefined" || !navigator.locks?.request) return;
    setIsWriting(true);
    try {
      await navigator.locks.request(OFFLINE_WRITE_LOCK, async () => {
        if (typeof indexedDB === "undefined") return;
        const req = indexedDB.open("WorkSphereOfflineDB");
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });

        if (db.objectStoreNames.contains("favorites-outbox")) {
          const tx = db.transaction("favorites-outbox", "readwrite");
          const store = tx.objectStore("favorites-outbox");
          store.put({
            venueId: `diag-venue-${Date.now()}`,
            action: "ADD",
            timestamp: Date.now(),
            retryCount: 0,
          });
          // Await IDBTransaction.oncomplete before lock callback resolves
          await wrapIdbTransaction(tx);
        }
      });
      await refresh();
    } catch (err) {
      console.warn("Diagnostic synchronized write failed:", err);
    } finally {
      setIsWriting(false);
    }
  };

  return (
    <div
      className={`rounded-xl p-5 space-y-4 text-sm transition-all ${
        highContrast
          ? "border-2 border-black dark:border-white bg-white dark:bg-black shadow-md"
          : "border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
      }`}
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
          <Lock className="w-4 h-4 text-blue-500" />
          Web Locks Diagnostic
        </h3>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setHighContrast((prev) => !prev)}
            aria-label="Toggle high-contrast metrics"
            aria-pressed={highContrast}
            title={
              highContrast
                ? "Disable high contrast metrics"
                : "Enable high contrast metrics"
            }
            className={`p-1.5 rounded-lg border transition-colors ${
              highContrast
                ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 border-zinc-900 dark:border-white"
                : "hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 border-transparent"
            }`}
          >
            <Contrast className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={refresh}
            disabled={isLoading}
            aria-label="Refresh lock state"
            className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 transition-colors disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`}
            />
          </button>
        </div>
      </div>

      {!isSupported && (
        <div
          className={`flex items-center gap-2 text-xs rounded-lg px-3 py-2 ${
            highContrast
              ? "border-2 border-amber-900 bg-amber-100 text-amber-950 font-bold dark:border-amber-400 dark:bg-amber-950 dark:text-amber-200"
              : "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20"
          }`}
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Web Locks API not supported in this browser.
        </div>
      )}

      {isSupported && (
        <>
          <div className="space-y-2">
            <p
              className={`text-xs font-medium uppercase tracking-wider ${
                highContrast
                  ? "text-black dark:text-white font-bold"
                  : "text-zinc-400"
              }`}
            >
              Lock: {OFFLINE_WRITE_LOCK}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div
                className={`rounded-lg px-3 py-2.5 flex items-center gap-2 ${
                  highContrast
                    ? lockState.held
                      ? "border-2 border-amber-700 bg-amber-200 text-amber-950 font-bold dark:border-amber-400 dark:bg-amber-950 dark:text-amber-100"
                      : "border-2 border-emerald-800 bg-emerald-100 text-emerald-950 font-bold dark:border-emerald-300 dark:bg-emerald-950 dark:text-emerald-100"
                    : lockState.held
                      ? "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400"
                      : "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400"
                }`}
              >
                {lockState.held ? (
                  <Clock className="w-4 h-4 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                )}
                <span className="font-medium text-xs">
                  {lockState.held ? "Held" : "Free"}
                </span>
              </div>
              <div
                className={`rounded-lg px-3 py-2.5 flex items-center gap-2 ${
                  highContrast
                    ? "border-2 border-black dark:border-white bg-zinc-100 dark:bg-zinc-900 text-black dark:text-white"
                    : "bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
                }`}
              >
                <span
                  className={`font-bold ${
                    highContrast
                      ? "text-black dark:text-white text-base"
                      : "text-zinc-900 dark:text-zinc-100"
                  }`}
                >
                  {lockState.pending}
                </span>
                <span
                  className={`text-xs ${
                    highContrast
                      ? "font-semibold text-zinc-900 dark:text-zinc-100"
                      : ""
                  }`}
                >
                  pending
                </span>
              </div>
            </div>

            {lockState.held && (
              <button
                type="button"
                onClick={forceReleaseLock}
                className={`w-full mt-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  highContrast
                    ? "border-2 border-red-700 bg-red-100 text-red-950 font-bold dark:border-red-400 dark:bg-red-950 dark:text-red-100"
                    : "border border-red-200 dark:border-red-800/40 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                }`}
              >
                Force Lock Release (dev only)
              </button>
            )}
          </div>

          <div
            className={`border-t pt-3 space-y-2 ${
              highContrast
                ? "border-black dark:border-white"
                : "border-zinc-100 dark:border-zinc-800"
            }`}
          >
            <p
              className={`text-xs font-medium uppercase tracking-wider ${
                highContrast
                  ? "text-black dark:text-white font-bold"
                  : "text-zinc-400"
              }`}
            >
              Sync Outbox
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div
                className={`rounded-lg px-3 py-2 ${
                  highContrast
                    ? "border-2 border-black dark:border-white bg-zinc-100 dark:bg-zinc-900 text-black dark:text-white"
                    : "bg-zinc-50 dark:bg-zinc-800"
                }`}
              >
                <span
                  className={`font-bold text-base ${
                    highContrast
                      ? "text-black dark:text-white"
                      : "text-zinc-900 dark:text-zinc-100"
                  }`}
                >
                  {outbox.favorites}
                </span>
                <p
                  className={`mt-0.5 ${
                    highContrast
                      ? "text-zinc-900 dark:text-zinc-100 font-medium"
                      : "text-zinc-500"
                  }`}
                >
                  Favorites
                </p>
              </div>
              <div
                className={`rounded-lg px-3 py-2 ${
                  highContrast
                    ? "border-2 border-black dark:border-white bg-zinc-100 dark:bg-zinc-900 text-black dark:text-white"
                    : "bg-zinc-50 dark:bg-zinc-800"
                }`}
              >
                <span
                  className={`font-bold text-base ${
                    highContrast
                      ? "text-black dark:text-white"
                      : "text-zinc-900 dark:text-zinc-100"
                  }`}
                >
                  {outbox.checkIns}
                </span>
                <p
                  className={`mt-0.5 ${
                    highContrast
                      ? "text-zinc-900 dark:text-zinc-100 font-medium"
                      : "text-zinc-500"
                  }`}
                >
                  Check-ins
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleSynchronizedWriteTest}
              disabled={isWriting || isLoading}
              className={`w-full mt-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                highContrast
                  ? "border-2 border-black dark:border-white bg-zinc-100 dark:bg-zinc-900 text-black dark:text-white font-bold hover:bg-zinc-200 dark:hover:bg-zinc-800"
                  : "border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
              }`}
            >
              {isWriting
                ? "Syncing IDB Write..."
                : "Test Synchronized IDB Write"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
