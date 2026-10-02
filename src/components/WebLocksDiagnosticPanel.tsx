"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Lock,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
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

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      // Check Web Locks API support
      const supported =
        typeof navigator !== "undefined" && "locks" in navigator;
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
    if (typeof navigator === "undefined" || !("locks" in navigator)) return;
    // Acquire then immediately release the lock to flush any stuck holder
    navigator.locks.request(
      OFFLINE_WRITE_LOCK,
      { steal: true },
      async () => void 0,
    );
    setTimeout(refresh, 300);
  };

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-4 text-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
          <Lock className="w-4 h-4 text-blue-500" />
          Web Locks Diagnostic
        </h3>
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

      {!isSupported && (
        <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 text-xs bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Web Locks API not supported in this browser.
        </div>
      )}

      {isSupported && (
        <>
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
              Lock: {OFFLINE_WRITE_LOCK}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div
                className={`rounded-lg px-3 py-2.5 flex items-center gap-2 ${
                  lockState.held
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
              <div className="bg-zinc-50 dark:bg-zinc-800 rounded-lg px-3 py-2.5 flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
                <span className="font-bold text-zinc-900 dark:text-zinc-100">
                  {lockState.pending}
                </span>
                <span className="text-xs">pending</span>
              </div>
            </div>

            {lockState.held && (
              <button
                type="button"
                onClick={forceReleaseLock}
                className="w-full mt-1 px-3 py-2 rounded-lg border border-red-200 dark:border-red-800/40 text-red-600 dark:text-red-400 text-xs font-medium hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                Force Lock Release (dev only)
              </button>
            )}
          </div>

          <div className="border-t border-zinc-100 dark:border-zinc-800 pt-3 space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
              Sync Outbox
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-zinc-50 dark:bg-zinc-800 rounded-lg px-3 py-2">
                <span className="font-bold text-zinc-900 dark:text-zinc-100 text-base">
                  {outbox.favorites}
                </span>
                <p className="text-zinc-500 mt-0.5">Favorites</p>
              </div>
              <div className="bg-zinc-50 dark:bg-zinc-800 rounded-lg px-3 py-2">
                <span className="font-bold text-zinc-900 dark:text-zinc-100 text-base">
                  {outbox.checkIns}
                </span>
                <p className="text-zinc-500 mt-0.5">Check-ins</p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
