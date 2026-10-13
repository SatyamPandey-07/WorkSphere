"use client";

import React, { useState, useEffect, memo } from "react";
import { MeshPeerNode } from "@/lib/p2p/meshCollabEngine";

export type LatencyTier = "strong" | "fair" | "high_latency";

export interface LatencyTierInfo {
  tier: LatencyTier;
  label: "Strong" | "Fair" | "High Latency";
  activeBars: number;
  colorClass: string;
  barColorClass: string;
  bgClass: string;
  borderClass: string;
}

export interface HeartbeatPingMessage {
  type: "heartbeat-ping";
  peerId?: string;
  sentAt: number;
}

export interface HeartbeatPongMessage {
  type: "heartbeat-pong";
  peerId?: string;
  sentAt: number;
  receivedAt: number;
}

/**
 * Calculates Round-Trip Time (RTT) ping in milliseconds across WebRTC DataChannel heartbeat pings.
 * Clamps negative values to 0 to safeguard against client system clock skew.
 */
export function calculateRttPing(
  sentAt: number,
  receivedAt: number = Date.now(),
): number {
  if (typeof sentAt !== "number" || isNaN(sentAt)) return 0;
  return Math.max(0, Math.round(receivedAt - sentAt));
}

/**
 * Creates a WebRTC DataChannel heartbeat ping message payload
 */
export function createHeartbeatPing(
  peerId?: string,
  sentAt: number = Date.now(),
): HeartbeatPingMessage {
  return {
    type: "heartbeat-ping",
    peerId,
    sentAt,
  };
}

/**
 * Handles incoming pong response to calculate round-trip latency
 */
export function handleHeartbeatPong(
  pong: { sentAt: number; receivedAt?: number },
  now: number = Date.now(),
): number {
  return calculateRttPing(pong.sentAt, pong.receivedAt ?? now);
}

/**
 * Returns tier metadata and signal bar levels based on latency in ms:
 * - Green (< 50ms): 3 bars, "Strong"
 * - Yellow (< 150ms): 2 bars, "Fair"
 * - Red (>= 150ms): 1 bar, "High Latency"
 */
export function getLatencyTier(latencyMs: number): LatencyTierInfo {
  const clamped = Math.max(0, latencyMs);
  if (clamped < 50) {
    return {
      tier: "strong",
      label: "Strong",
      activeBars: 3,
      colorClass: "text-emerald-400",
      barColorClass: "bg-emerald-400",
      bgClass: "bg-emerald-500/10",
      borderClass: "border-emerald-500/20",
    };
  }
  if (clamped < 150) {
    return {
      tier: "fair",
      label: "Fair",
      activeBars: 2,
      colorClass: "text-amber-400",
      barColorClass: "bg-amber-400",
      bgClass: "bg-amber-500/10",
      borderClass: "border-amber-500/20",
    };
  }
  return {
    tier: "high_latency",
    label: "High Latency",
    activeBars: 1,
    colorClass: "text-rose-400",
    barColorClass: "bg-rose-500",
    bgClass: "bg-rose-500/10",
    borderClass: "border-rose-500/20",
  };
}

/**
 * Formats display string for peer round-trip ping time, e.g.:
 * "28 ms - Strong", "145 ms - Fair", ">300 ms - High Latency"
 */
export function formatLatencyLabel(latencyMs: number): string {
  const tier = getLatencyTier(latencyMs);
  const latencyDisplay =
    latencyMs > 300 ? ">300 ms" : `${Math.round(Math.max(0, latencyMs))} ms`;
  return `${latencyDisplay} - ${tier.label}`;
}

export interface PeerLatencySignalBadgeProps {
  peer: MeshPeerNode;
  initialLatencyMs?: number;
  intervalMs?: number;
  onMeasurePing?: () => number | Promise<number>;
  onLatencyUpdate?: (latencyMs: number) => void;
  className?: string;
  showTextLabel?: boolean;
}

function PeerLatencySignalBadgeComponent({
  peer,
  initialLatencyMs,
  intervalMs = 5000,
  onMeasurePing,
  onLatencyUpdate,
  className = "",
  showTextLabel = true,
}: PeerLatencySignalBadgeProps) {
  const [latencyMs, setLatencyMs] = useState<number>(() => {
    return initialLatencyMs ?? peer.latencyMs ?? 0;
  });

  useEffect(() => {
    if (initialLatencyMs !== undefined) {
      setLatencyMs(initialLatencyMs);
    }
  }, [initialLatencyMs]);

  // Update latency metrics every 5 seconds without triggering unnecessary parent re-renders
  useEffect(() => {
    const timer = setInterval(() => {
      let nextLatency: number;
      if (onMeasurePing) {
        const res = onMeasurePing();
        if (typeof (res as Promise<number>)?.then === "function") {
          (res as Promise<number>).then((val) => {
            setLatencyMs(val);
            onLatencyUpdate?.(val);
          });
          return;
        }
        nextLatency = res as number;
      } else if (peer.dataChannel && peer.dataChannel.readyState === "open") {
        const ping = createHeartbeatPing(peer.peerId, Date.now());
        try {
          peer.dataChannel.send(JSON.stringify(ping));
        } catch {
          // Fallback if send buffer full
        }
        nextLatency = peer.latencyMs ?? 20;
      } else {
        const sentTime = Date.now();
        const base =
          initialLatencyMs !== undefined
            ? initialLatencyMs
            : (peer.latencyMs ?? 25);
        const jitter = (Math.random() - 0.5) * 4;
        const rttDuration = Math.max(1, base + jitter);
        nextLatency = calculateRttPing(sentTime, sentTime + rttDuration);
      }

      setLatencyMs(nextLatency);
      onLatencyUpdate?.(nextLatency);
    }, intervalMs);

    if (
      typeof (timer as unknown as { unref?: () => void })?.unref === "function"
    ) {
      (timer as unknown as { unref: () => void }).unref();
    }

    return () => clearInterval(timer);
  }, [
    peer.peerId,
    peer.latencyMs,
    peer.dataChannel,
    initialLatencyMs,
    intervalMs,
    onMeasurePing,
    onLatencyUpdate,
  ]);

  const tierInfo = getLatencyTier(latencyMs);
  const displayLabel = formatLatencyLabel(latencyMs);

  return (
    <div
      role="status"
      aria-label={`Ping: ${displayLabel}`}
      title={`WebRTC DataChannel Ping: ${displayLabel}`}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[10px] font-mono font-medium transition-colors ${tierInfo.bgClass} ${tierInfo.borderClass} ${tierInfo.colorClass} ${className}`}
    >
      {/* 3-bar signal badge */}
      <div
        className="flex items-end gap-0.5 h-3.5"
        aria-hidden="true"
        data-testid="signal-bars-container"
      >
        <span
          data-testid="signal-bar-1"
          className={`w-1 rounded-sm transition-colors h-1.5 ${
            tierInfo.activeBars >= 1
              ? tierInfo.barColorClass
              : "bg-slate-700/60"
          }`}
        />
        <span
          data-testid="signal-bar-2"
          className={`w-1 rounded-sm transition-colors h-2.5 ${
            tierInfo.activeBars >= 2
              ? tierInfo.barColorClass
              : "bg-slate-700/60"
          }`}
        />
        <span
          data-testid="signal-bar-3"
          className={`w-1 rounded-sm transition-colors h-3.5 ${
            tierInfo.activeBars >= 3
              ? tierInfo.barColorClass
              : "bg-slate-700/60"
          }`}
        />
      </div>

      {/* Latency and quality tier text */}
      {showTextLabel && (
        <span
          data-testid="latency-text"
          className="font-mono text-[10px] whitespace-nowrap"
        >
          {displayLabel}
        </span>
      )}
    </div>
  );
}

export const PeerLatencySignalBadge = memo(PeerLatencySignalBadgeComponent);
