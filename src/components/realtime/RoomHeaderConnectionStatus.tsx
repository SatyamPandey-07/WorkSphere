"use client";

import React from "react";
import { ConnectionStatus } from "@/hooks/usePartySocket";
import { Wifi, WifiOff, RefreshCw, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TurnRelayStatus } from "@/lib/realtime/webrtc/meshConnection";

export interface RoomHeaderConnectionStatusProps {
  status?: ConnectionStatus;
  reconnectAttempt?: number;
  className?: string;
  isRelayed?: boolean;
  relayStatus?: TurnRelayStatus;
}

/**
 * Connection status indicator component for collaborative room headers (#4380, #9727).
 * Displays real-time WebSocket connection state: Connected, Reconnecting (with backoff attempt count), or Offline.
 * Also renders a subtle "Relay Mode: Bandwidth Optimized" status chip when running over TURN relay.
 */
export function RoomHeaderConnectionStatus({
  status = "offline",
  reconnectAttempt = 0,
  className,
  isRelayed = false,
  relayStatus,
}: RoomHeaderConnectionStatusProps) {
  const safeAttempt =
    typeof reconnectAttempt === "number" &&
    Number.isFinite(reconnectAttempt) &&
    reconnectAttempt > 0
      ? Math.floor(reconnectAttempt)
      : 0;

  const showRelayBadge = isRelayed || relayStatus === "relay";

  const renderStatus = () => {
    if (status === "connected") {
      return (
        <div
          role="status"
          aria-live="polite"
          aria-label="Room connection status: connected"
          data-testid="room-status-connected"
          data-status="connected"
          className={cn(
            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 backdrop-blur-sm transition-all",
            className,
          )}
        >
          <span className="relative flex h-2 w-2" aria-hidden="true">
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <Wifi className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Connected</span>
        </div>
      );
    }

    if (status === "reconnecting") {
      return (
        <div
          role="status"
          aria-live="polite"
          aria-label={`Room connection status: reconnecting${safeAttempt > 0 ? ` (${safeAttempt})` : ""}`}
          data-testid="room-status-reconnecting"
          data-status="reconnecting"
          className={cn(
            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 backdrop-blur-sm transition-all",
            className,
          )}
        >
          <span className="relative flex h-2 w-2" aria-hidden="true">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
          </span>
          <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
          <span>
            Reconnecting{safeAttempt > 0 ? ` (${safeAttempt})` : ""}...
          </span>
        </div>
      );
    }

    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Room connection status: offline"
        data-testid="room-status-offline"
        data-status="offline"
        className={cn(
          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 backdrop-blur-sm transition-all",
          className,
        )}
      >
        <span className="relative flex h-2 w-2" aria-hidden="true">
          <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500" />
        </span>
        <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
        <span>Offline</span>
      </div>
    );
  };

  if (!showRelayBadge) {
    return renderStatus();
  }

  return (
    <div className="inline-flex items-center gap-2">
      {renderStatus()}
      <div
        role="status"
        aria-live="polite"
        aria-label="Relay Mode: Bandwidth Optimized"
        data-testid="room-status-relay"
        data-status="relay"
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 backdrop-blur-sm transition-all"
        title="Running over TURN relay: Bandwidth budget optimized to 48 kbps"
      >
        <Zap className="w-3.5 h-3.5 text-amber-500 animate-pulse" aria-hidden="true" />
        <span>Relay Mode: Bandwidth Optimized</span>
      </div>
    </div>
  );
}

export default RoomHeaderConnectionStatus;
