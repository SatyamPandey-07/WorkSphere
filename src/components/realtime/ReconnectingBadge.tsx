"use client";

import React from "react";
import { ConnectionStatus } from "@/hooks/usePartySocket";
import { ConnectionLifecycleState } from "@/lib/realtime/connectionState";

interface ReconnectingBadgeProps {
  status?: ConnectionStatus | ConnectionLifecycleState;
  lifecycleState?: ConnectionLifecycleState;
  isReconnecting?: boolean;
  attempt?: number;
  className?: string;
}

/**
 * ReconnectingBadge: Subtle status indicator badge shown in the UI
 * when PartyKit WebSocket is reconnecting with exponential backoff.
 */
export function ReconnectingBadge({
  status,
  lifecycleState,
  isReconnecting,
  attempt,
  className = "",
}: ReconnectingBadgeProps) {
  const shouldShow =
    isReconnecting ||
    status === "reconnecting" ||
    status === ConnectionLifecycleState.RECONNECTING ||
    lifecycleState === ConnectionLifecycleState.RECONNECTING ||
    (typeof attempt === "number" &&
      attempt > 0 &&
      status !== "connected" &&
      status !== ConnectionLifecycleState.CONNECTED);

  if (!shouldShow) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30 backdrop-blur-sm transition-opacity duration-200 ${className}`}
    >
      <span className="relative flex h-2 w-2" aria-hidden="true">
        <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 motion-reduce:hidden" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500 motion-safe:animate-pulse" />
      </span>
      <span>Reconnecting...</span>
    </div>
  );
}

export default ReconnectingBadge;
