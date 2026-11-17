"use client";

import React from "react";
import { AlertTriangle, Loader2, WifiOff } from "lucide-react";
import type { ConnectionStatus } from "./ConnectionStatusPill";

export interface OfflineSyncBannerProps {
  status: ConnectionStatus;
  pendingCount: number;
  isLocalPersistenceReady: boolean;
  isSyncing?: boolean;
  className?: string;
}

/**
 * Offline warning banner and unsynchronized edits counter for GroupNotesEditor (#7843).
 *
 * Displays:
 * 1. Persistent warning when disconnected and using local IndexedDB fallback.
 * 2. Unsynchronized edits counter ("X pending change(s)").
 * 3. Fallback warning if IndexedDB persistence failed to initialize.
 * 4. Active sync indicator when reconnecting and flushing the outbox.
 */
export function OfflineSyncBanner({
  status,
  pendingCount,
  isLocalPersistenceReady,
  isSyncing = false,
  className = "",
}: OfflineSyncBannerProps) {
  // Hide banner when connected and no sync is in flight
  if (status === "connected" && !isSyncing && pendingCount === 0) {
    return null;
  }

  // Active synchronization in progress upon reconnecting
  if (isSyncing && status === "connected") {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="offline-sync-banner"
        data-syncing="true"
        className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-900 transition-all dark:border-blue-500/20 dark:bg-blue-950/30 dark:text-blue-200 ${className}`}
      >
        <div className="flex items-center gap-2">
          <Loader2
            className="h-4 w-4 shrink-0 animate-spin text-blue-600 dark:text-blue-400"
            aria-hidden="true"
          />
          <span className="font-medium">Syncing changes with server...</span>
        </div>
        <span
          data-testid="pending-sync-counter"
          className="inline-flex items-center rounded-full bg-blue-200/60 px-2 py-0.5 text-[11px] font-bold text-blue-800 dark:bg-blue-900/60 dark:text-blue-200"
        >
          {pendingCount}{" "}
          {pendingCount === 1 ? "pending change" : "pending changes"}
        </span>
      </div>
    );
  }

  // Disconnected and local persistence initialization failed
  if (
    !isLocalPersistenceReady &&
    (status === "disconnected" || status === "connecting")
  ) {
    return (
      <div
        role="alert"
        data-testid="offline-sync-banner"
        data-persistence-ready="false"
        className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-900 transition-all dark:border-red-500/20 dark:bg-red-950/30 dark:text-red-200 ${className}`}
      >
        <div className="flex items-center gap-2">
          <AlertTriangle
            className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400"
            aria-hidden="true"
          />
          <span className="font-medium">
            You&apos;re offline. Local persistence is unavailable — changes may
            not be saved locally.
          </span>
        </div>
        <span
          data-testid="pending-sync-counter"
          className="inline-flex items-center rounded-full bg-red-200/60 px-2 py-0.5 text-[11px] font-bold text-red-800 dark:bg-red-900/60 dark:text-red-200"
        >
          Persistence Unavailable
        </span>
      </div>
    );
  }

  // Offline / reconnecting with active IndexedDB local fallback
  if (status === "disconnected" || status === "connecting") {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="offline-sync-banner"
        data-persistence-ready="true"
        className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 transition-all dark:border-amber-500/20 dark:bg-amber-950/30 dark:text-amber-200 ${className}`}
      >
        <div className="flex items-center gap-2">
          <WifiOff
            className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
          <span>
            You&apos;re offline. Your changes are saved locally and will sync
            when you&apos;re reconnected.
          </span>
        </div>
        <span
          data-testid="pending-sync-counter"
          className="inline-flex items-center rounded-full bg-amber-200/60 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-900/60 dark:text-amber-200"
        >
          {pendingCount}{" "}
          {pendingCount === 1 ? "pending change" : "pending changes"}
        </span>
      </div>
    );
  }

  return null;
}

export default OfflineSyncBanner;
