"use client";

import React from "react";
import { cn, sanitizeExternalHttpUrl } from "@/lib/utils";
import type { PeerTelemetry } from "@/hooks/useMeshDataChannels";

export interface TopologyPeerNode {
  peerId: string;
  displayName?: string;
  avatarUrl?: string;
  role?: string;
  rttMs?: number | null;
  status?: "connected" | "connecting" | "disconnected";
}

export type LatencyBadgeTone = "green" | "yellow" | "red" | "unknown";

export interface LatencyBadgeTier {
  tone: LatencyBadgeTone;
  label: string;
  statusText: string;
  badgeClassName: string;
  dotClassName: string;
}

/**
 * Classifies peer RTT latency into display tiers:
 * - Green: < 50ms
 * - Yellow: 50ms - 150ms (inclusive)
 * - Red: > 150ms
 */
export function getLatencyBadgeTier(
  rttMs: number | null | undefined,
): LatencyBadgeTier {
  if (typeof rttMs !== "number" || !Number.isFinite(rttMs) || rttMs < 0) {
    return {
      tone: "unknown",
      label: "-- ms",
      statusText: "Measuring latency",
      badgeClassName: "border-zinc-700 bg-zinc-800/80 text-zinc-300",
      dotClassName: "bg-zinc-400",
    };
  }

  const rounded = Math.round(rttMs);
  if (rounded < 50) {
    return {
      tone: "green",
      label: `${rounded} ms`,
      statusText: "Low latency",
      badgeClassName:
        "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
      dotClassName: "bg-emerald-400",
    };
  }

  if (rounded <= 150) {
    return {
      tone: "yellow",
      label: `${rounded} ms`,
      statusText: "Moderate latency",
      badgeClassName: "border-amber-500/40 bg-amber-500/15 text-amber-300",
      dotClassName: "bg-amber-400",
    };
  }

  return {
    tone: "red",
    label: `${rounded} ms`,
    statusText: "High latency",
    badgeClassName: "border-rose-500/40 bg-rose-500/15 text-rose-300",
    dotClassName: "bg-rose-400",
  };
}

function getInitials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export interface PeerTopologyVisualizerProps {
  localPeerId: string;
  localDisplayName?: string;
  peers: TopologyPeerNode[];
  peerLatencies?: Record<string, number | null>;
  peerTelemetry?: Record<string, PeerTelemetry>;
  className?: string;
}

/**
 * Displays connected P2P workspace peers around the local node with live RTT latency badges.
 */
export function PeerTopologyVisualizer({
  localPeerId,
  localDisplayName = "You",
  peers,
  peerLatencies,
  peerTelemetry,
  className,
}: PeerTopologyVisualizerProps) {
  return (
    <section
      aria-label="Collaborative workspace peer topology"
      data-testid="peer-topology-visualizer"
      className={cn(
        "rounded-2xl border border-zinc-800 bg-zinc-950/90 p-4 text-zinc-100 shadow-sm",
        className,
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-indigo-500/40 bg-indigo-500/20 text-[11px] font-bold text-indigo-300">
            {getInitials(localDisplayName)}
          </span>
          <div>
            <h3 className="text-xs font-semibold text-zinc-100">
              {localDisplayName}{" "}
              <span className="font-mono text-[11px] font-normal text-zinc-400">
                ({localPeerId})
              </span>
            </h3>
            <p className="text-[11px] text-zinc-400">
              {peers.length} connected{" "}
              {peers.length === 1 ? "collaborator" : "collaborators"}
            </p>
          </div>
        </div>
      </div>

      {peers.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-800 px-3 py-4 text-center text-xs text-zinc-400">
          No remote peers connected to mesh.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {peers.map((peer) => {
            const resolvedRtt =
              peerLatencies?.[peer.peerId] ??
              peerTelemetry?.[peer.peerId]?.rttMs ??
              peer.rttMs ??
              null;
            const tier = getLatencyBadgeTier(resolvedRtt);
            const label = peer.displayName?.trim() || peer.peerId;
            const safeAvatarUrl = sanitizeExternalHttpUrl(peer.avatarUrl);

            return (
              <li
                key={peer.peerId}
                data-testid={`topology-peer-${peer.peerId}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800/90 bg-zinc-900/70 px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-700 bg-zinc-800 text-xs font-semibold text-zinc-200">
                    {safeAvatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={safeAvatarUrl}
                        alt={`${label} avatar`}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span>{getInitials(label)}</span>
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-zinc-100">
                      {label}
                    </div>
                    {peer.role && (
                      <div className="truncate text-[10px] text-zinc-400">
                        {peer.role}
                      </div>
                    )}
                  </div>
                </div>

                <span
                  role="status"
                  data-testid={`peer-latency-badge-${peer.peerId}`}
                  data-latency-tier={tier.tone}
                  aria-label={`Latency to ${label}: ${tier.label} (${tier.statusText})`}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] font-medium",
                    tier.badgeClassName,
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn("h-1.5 w-1.5 rounded-full", tier.dotClassName)}
                  />
                  <span>{tier.label}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default PeerTopologyVisualizer;
