'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Activity, ChevronDown, ChevronUp, Wifi, X } from 'lucide-react';

export type QualityTierLevel = 'Excellent' | 'Good' | 'Poor';

export interface QualityTierInfo {
  tier: QualityTierLevel;
  color: string;
  badgeClass: string;
  dotClass: string;
}

export interface ParsedStats {
  rttMs: number;
  packetLossPct: number;
  packetsLost: number;
  packetsTotal: number;
}

/**
 * Computes connection quality tier from RTT and packet loss.
 * Color-coded indicator: Green < 100ms, Yellow 100-300ms, Red > 300ms.
 */
export function getQualityTier(rttMs: number, packetLossPct: number = 0): QualityTierInfo {
  if (rttMs < 100 && packetLossPct < 2) {
    return {
      tier: 'Excellent',
      color: '#10b981',
      badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800',
      dotClass: 'bg-emerald-500',
    };
  }
  if (rttMs <= 300 && packetLossPct < 5) {
    return {
      tier: 'Good',
      color: '#eab308',
      badgeClass: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800',
      dotClass: 'bg-amber-500',
    };
  }
  return {
    tier: 'Poor',
    color: '#ef4444',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800',
    dotClass: 'bg-rose-500',
  };
}

/**
 * Parses RTCStatsReport to extract round-trip time (RTT in ms) and packet loss percentage.
 */
export function parseRtcStatsReport(stats: any): ParsedStats {
  let rttMs = 0;
  let packetsLost = 0;
  let packetsReceived = 0;

  if (!stats) {
    return { rttMs: 0, packetLossPct: 0, packetsLost: 0, packetsTotal: 0 };
  }

  const entries: any[] = typeof stats.forEach === 'function'
    ? Array.from(stats.values ? stats.values() : stats)
    : Array.isArray(stats)
    ? stats
    : Object.values(stats);

  for (const report of entries) {
    if (!report || typeof report !== 'object') continue;

    // Extract candidate-pair RTT
    if (
      report.type === 'candidate-pair' &&
      (report.state === 'succeeded' || report.nominated || report.selected)
    ) {
      if (typeof report.currentRoundTripTime === 'number') {
        rttMs = Math.round(report.currentRoundTripTime * 1000);
      } else if (typeof report.totalRoundTripTime === 'number' && report.responsesReceived > 0) {
        rttMs = Math.round((report.totalRoundTripTime / report.responsesReceived) * 1000);
      }
    }

    // Extract packet loss
    if (report.type === 'inbound-rtp' || report.type === 'remote-inbound-rtp') {
      if (typeof report.packetsLost === 'number') {
        packetsLost += report.packetsLost;
      }
      if (typeof report.packetsReceived === 'number') {
        packetsReceived += report.packetsReceived;
      }
    }
  }

  const packetsTotal = packetsReceived + packetsLost;
  const packetLossPct = packetsTotal > 0 ? Math.min(100, Math.round((packetsLost / packetsTotal) * 1000) / 10) : 0;

  return { rttMs, packetLossPct, packetsLost, packetsTotal };
}

export interface PeerConnectionHudProps {
  peerConnections?: Map<string, RTCPeerConnection> | Record<string, RTCPeerConnection>;
  activePeerId?: string;
  sampleIntervalMs?: number;
  initialMinimized?: boolean;
  className?: string;
  onClose?: () => void;
}

export const PeerConnectionHud: React.FC<PeerConnectionHudProps> = ({
  peerConnections,
  activePeerId,
  sampleIntervalMs = 3000,
  initialMinimized = false,
  className = '',
  onClose,
}) => {
  const [isMinimized, setIsMinimized] = useState(initialMinimized);
  const [stats, setStats] = useState<ParsedStats>({
    rttMs: 45,
    packetLossPct: 0,
    packetsLost: 0,
    packetsTotal: 0,
  });

  const sampleStats = useCallback(async () => {
    if (!peerConnections) return;

    let targetPc: RTCPeerConnection | null = null;
    if (peerConnections instanceof Map) {
      targetPc = activePeerId ? peerConnections.get(activePeerId) ?? null : peerConnections.values().next().value ?? null;
    } else if (typeof peerConnections === 'object') {
      targetPc = activePeerId ? peerConnections[activePeerId] ?? null : Object.values(peerConnections)[0] ?? null;
    }

    if (!targetPc || typeof targetPc.getStats !== 'function') return;

    try {
      const report = await targetPc.getStats();
      const parsed = parseRtcStatsReport(report);
      setStats((prev) => ({
        ...parsed,
        // Exponential Moving Average (alpha = 0.3)
        rttMs: prev.rttMs > 0 && parsed.rttMs > 0
          ? Math.round(0.3 * parsed.rttMs + 0.7 * prev.rttMs)
          : parsed.rttMs || prev.rttMs,
      }));
    } catch {
      // Ignored during connection teardown
    }
  }, [peerConnections, activePeerId]);

  useEffect(() => {
    sampleStats();
    const interval = setInterval(sampleStats, sampleIntervalMs);
    return () => clearInterval(interval);
  }, [sampleStats, sampleIntervalMs]);

  const tierInfo = useMemo(() => {
    return getQualityTier(stats.rttMs, stats.packetLossPct);
  }, [stats.rttMs, stats.packetLossPct]);

  if (isMinimized) {
    return (
      <button
        type="button"
        data-testid="peer-hud-minimized-pill"
        onClick={() => setIsMinimized(false)}
        className={`fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-md backdrop-blur-md transition ${tierInfo.badgeClass} ${className}`}
        aria-label="Expand WebRTC Network Diagnostics HUD"
      >
        <span className={`h-2 w-2 rounded-full ${tierInfo.dotClass}`} />
        <span>{stats.rttMs}ms</span>
        <ChevronUp className="h-3.5 w-3.5 opacity-70" />
      </button>
    );
  }

  return (
    <div
      role="region"
      aria-label="WebRTC Connection Diagnostics HUD"
      data-testid="peer-connection-hud"
      className={`fixed bottom-4 right-4 z-50 w-72 rounded-xl border border-slate-200 bg-white/95 p-3.5 text-xs shadow-lg backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95 dark:text-slate-200 ${className}`}
    >
      <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-100">
          <Activity className="h-4 w-4 text-indigo-500" />
          <span>Network Health HUD</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            data-testid="peer-hud-minimize-btn"
            onClick={() => setIsMinimized(true)}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            aria-label="Minimize HUD"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {onClose && (
            <button
              type="button"
              data-testid="peer-hud-close-btn"
              onClick={onClose}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
              aria-label="Close HUD"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="mt-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-slate-500 dark:text-slate-400">Connection Tier</span>
          <span
            data-testid="peer-hud-quality-tier"
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-semibold ${tierInfo.badgeClass}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${tierInfo.dotClass}`} />
            {tierInfo.tier}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-slate-500 dark:text-slate-400">Round-Trip Time (RTT)</span>
          <span data-testid="peer-hud-rtt" className="font-mono font-medium text-slate-700 dark:text-slate-200">
            {stats.rttMs} ms
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-slate-500 dark:text-slate-400">Packet Loss</span>
          <span data-testid="peer-hud-packet-loss" className="font-mono font-medium text-slate-700 dark:text-slate-200">
            {stats.packetLossPct}%
          </span>
        </div>

        {activePeerId && (
          <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800 text-[11px]">
            <span className="text-slate-400">Active Peer</span>
            <span className="font-mono text-slate-500 truncate max-w-[120px]">{activePeerId}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default PeerConnectionHud;
