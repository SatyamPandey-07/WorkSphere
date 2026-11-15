"use client";

import React from "react";
import { ConnectionStatus } from "@/hooks/usePartySocket";
import { ConnectionLifecycleState } from "@/lib/realtime/connectionState";
import { cn } from "@/lib/utils";

export interface ReconnectingBadgeProps {
  status?: ConnectionStatus | ConnectionLifecycleState;
  lifecycleState?: ConnectionLifecycleState;
  isReconnecting?: boolean;
  attempt?: number;
  showAttempt?: boolean;
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
  showAttempt = false,
  className,
}: ReconnectingBadgeProps) {
  const safeAttempt =
    typeof attempt === "number" && Number.isFinite(attempt) && attempt > 0
      ? Math.floor(attempt)
      : 0;

  const shouldShow =
    Boolean(isReconnecting) ||
    status === "reconnecting" ||
    status === ConnectionLifecycleState.RECONNECTING ||
    lifecycleState === ConnectionLifecycleState.RECONNECTING ||
    (safeAttempt > 0 &&
      status !== "connected" &&
      status !== ConnectionLifecycleState.CONNECTED);

  if (!shouldShow) return null;

  const labelText =
    showAttempt && safeAttempt > 0
      ? `Reconnecting (attempt ${safeAttempt})...`
      : "Reconnecting...";

  const accessibleLabel =
    safeAttempt > 0
      ? `Connection status: reconnecting (attempt ${safeAttempt})`
      : "Connection status: reconnecting";

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={accessibleLabel}
      data-testid="reconnecting-badge"
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30 backdrop-blur-sm transition-opacity duration-200",
        className,
      )}
    >
      <span
        data-testid="reconnecting-badge-ping"
        className="relative flex h-2 w-2"
        aria-hidden="true"
      >
        <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 motion-reduce:hidden" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500 motion-safe:animate-pulse" />
      </span>
      <span data-testid="reconnecting-badge-label">{labelText}</span>
    </div>
  );
}

export default ReconnectingBadge;
