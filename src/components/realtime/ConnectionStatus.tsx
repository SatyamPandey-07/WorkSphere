"use client";

import React from "react";

export interface ConnectionStatusProps {
  /**
   * Boolean flag for simple connected/reconnecting state,
   * or granular status state: "connected" | "connecting" | "reconnecting" | "disconnected" | "offline".
   */
  isConnected?: boolean;
  status?: "connected" | "connecting" | "reconnecting" | "disconnected" | "offline";
  className?: string;
}

/**
 * Connection status indicator component
 * Displays status badge with pulsing ping dot when actively connected,
 * while respecting prefers-reduced-motion.
 */
export function ConnectionStatus({
  isConnected,
  status: statusProp,
  className = "",
}: ConnectionStatusProps) {
  // Determine normalized status
  let resolvedStatus: "connected" | "connecting" | "reconnecting" | "disconnected" = "connecting";

  if (statusProp) {
    if (statusProp === "connected") {
      resolvedStatus = "connected";
    } else if (statusProp === "reconnecting") {
      resolvedStatus = "reconnecting";
    } else if (statusProp === "disconnected" || statusProp === "offline") {
      resolvedStatus = "disconnected";
    } else {
      resolvedStatus = "connecting";
    }
  } else if (typeof isConnected === "boolean") {
    resolvedStatus = isConnected ? "connected" : "reconnecting";
  }

  if (resolvedStatus === "connected") {
    return (
      <div
        role="status"
        aria-live="polite"
        className={`inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium ${className}`}
      >
        <span className="relative flex h-2.5 w-2.5 items-center justify-center" aria-hidden="true">
          <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 motion-reduce:hidden" />
          <span
            data-testid="lantern-power-core"
            className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 shadow-[0_0_8px_#10b981] motion-safe:animate-[pulse_3s_cubic-bezier(0.4,0,0.6,1)_infinite]"
            style={{
              filter: "drop-shadow(0 0 6px #10b981)",
            }}
          />
        </span>
        Live
      </div>
    );
  }

  if (resolvedStatus === "connecting" || resolvedStatus === "reconnecting") {
    return (
      <div
        role="status"
        aria-live="polite"
        className={`inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-medium ${className}`}
      >
        <span className="relative flex h-2 w-2" aria-hidden="true">
          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
        </span>
        Reconnecting...
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 font-medium ${className}`}
    >
      <span className="relative flex h-2 w-2" aria-hidden="true">
        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
      </span>
      Offline
    </div>
  );
}

export default ConnectionStatus;
