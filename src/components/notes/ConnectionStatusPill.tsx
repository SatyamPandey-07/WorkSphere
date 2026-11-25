"use client";

import React from "react";
import { Loader2, Wifi, WifiOff } from "lucide-react";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export interface ConnectionStatusPillProps {
  status: ConnectionStatus;
  pendingCount?: number;
  className?: string;
}

/**
 * Animated connection status pill for the collaborative notes toolbar (#7843).
 * Visual states:
 * - Online (Connected): Green indicator, subtle pulse
 * - Reconnecting: Amber indicator, subtle spinner
 * - Offline: Red warning indicator with unsynced changes indicator
 */
export function ConnectionStatusPill({
  status,
  pendingCount = 0,
  className = "",
}: ConnectionStatusPillProps) {
  if (status === "connected") {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Connection status: Connected"
        data-testid="connection-status-pill"
        data-status="connected"
        className={`inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-50/80 px-2.5 py-1 text-xs font-semibold text-emerald-700 transition-colors dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-300 ${className}`}
      >
        <span
          className="relative flex h-2 w-2 items-center justify-center"
          aria-hidden="true"
        >
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 motion-safe:animate-ping motion-reduce:hidden" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_#10b981]" />
        </span>
        <Wifi
          className="h-3 w-3 text-emerald-600 dark:text-emerald-400"
          aria-hidden="true"
        />
        <span>Connected</span>
      </div>
    );
  }

  if (status === "connecting") {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Connection status: Reconnecting"
        data-testid="connection-status-pill"
        data-status="connecting"
        className={`inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-50/80 px-2.5 py-1 text-xs font-semibold text-amber-700 transition-colors dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-300 ${className}`}
      >
        <Loader2
          className="h-3 w-3 text-amber-600 motion-safe:animate-spin motion-reduce:animate-none dark:text-amber-400"
          aria-hidden="true"
        />
        <span>Reconnecting...</span>
      </div>
    );
  }

  // status === "disconnected"
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Connection status: Offline${pendingCount > 0 ? `, ${pendingCount} unsynchronized changes` : ""}`}
      data-testid="connection-status-pill"
      data-status="disconnected"
      className={`inline-flex items-center gap-1.5 rounded-full border border-red-500/20 bg-red-50/80 px-2.5 py-1 text-xs font-semibold text-red-700 transition-colors dark:border-red-500/30 dark:bg-red-950/40 dark:text-red-300 ${className}`}
    >
      <WifiOff
        className="h-3 w-3 text-red-600 dark:text-red-400"
        aria-hidden="true"
      />
      <span>Offline</span>
      {pendingCount > 0 && (
        <span
          data-testid="pill-unsynced-indicator"
          className="text-[10px] font-medium text-red-600/80 dark:text-red-400/80"
        >
          ({pendingCount} unsynced)
        </span>
      )}
    </div>
  );
}

export default ConnectionStatusPill;
