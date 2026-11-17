"use client";

import React, { useMemo } from "react";
import {
  Activity,
  Download,
  Wifi,
  ShieldCheck,
  AlertTriangle,
  Radio,
} from "lucide-react";

export interface NetworkSample {
  timestamp: number;
  rttMs: number | null;
  lost?: boolean;
}

export type NetworkQualityGrade = "Excellent" | "Good" | "Fair" | "Poor";

export interface NetworkGradeInfo {
  grade: NetworkQualityGrade;
  label: string;
  badgeClass: string;
  dotClass: string;
  description: string;
}

export interface NetworkDiagnosticsData {
  timestamp: string;
  connectionType: string;
  venueId?: string;
  venueName?: string;
  telemetryMetrics: {
    medianRttMs: number;
    jitterMs: number;
    packetLossPercentage: number;
    qualityGrade: NetworkQualityGrade;
    qualityLabel: string;
    sampleCount: number;
    rollingWindowSeconds: number;
    samples: NetworkSample[];
  };
}

/**
 * Computes median from an array of numbers.
 */
export function calculateMedian(values: number[]): number {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) {
    return Number(sorted[mid].toFixed(1));
  }
  return Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(1));
}

/**
 * Computes jitter as the mean difference between consecutive RTT samples.
 * Jitter = (1 / (N - 1)) * Sum(|R_i - R_(i-1)|)
 */
export function calculateJitter(samples: number[]): number {
  if (!samples || samples.length < 2) return 0;
  let totalDiff = 0;
  for (let i = 1; i < samples.length; i++) {
    totalDiff += Math.abs(samples[i] - samples[i - 1]);
  }
  return Number((totalDiff / (samples.length - 1)).toFixed(1));
}

/**
 * Computes packet loss percentage over a rolling window (defaults to 60 seconds).
 */
export function calculatePacketLoss(
  samples: NetworkSample[],
  windowMs = 60000,
  referenceNow = Date.now(),
): number {
  if (!samples || samples.length === 0) return 0;
  const cutoff = referenceNow - windowMs;
  const windowSamples = samples.filter((s) => s.timestamp >= cutoff);

  if (windowSamples.length === 0) return 0;

  const lostCount = windowSamples.filter(
    (s) => s.lost === true || s.rttMs === null || Number.isNaN(s.rttMs),
  ).length;

  return Number(((lostCount / windowSamples.length) * 100).toFixed(1));
}

/**
 * Evaluates the quality grade based on latency, jitter, and packet loss:
 *  - Excellent: <30ms RTT, <5ms jitter
 *  - Good: 30-80ms RTT
 *  - Fair: 80-150ms RTT
 *  - Poor: >150ms RTT (or severe packet loss >= 10%)
 */
export function getNetworkQualityGrade(
  medianRttMs: number,
  jitterMs: number,
  packetLossPercentage = 0,
): NetworkGradeInfo {
  if (medianRttMs > 150 || packetLossPercentage >= 10) {
    return {
      grade: "Poor",
      label: "Poor (>150ms)",
      badgeClass:
        "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
      dotClass: "bg-rose-500",
      description: "Substantial lag, audio drops, and buffering likely.",
    };
  }

  if (medianRttMs > 80 || packetLossPercentage >= 3) {
    return {
      grade: "Fair",
      label: "Fair (80-150ms)",
      badgeClass:
        "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
      dotClass: "bg-amber-500",
      description: "Noticeable delay during interactive screen share.",
    };
  }

  if (medianRttMs < 30 && jitterMs < 5 && packetLossPercentage < 1) {
    return {
      grade: "Excellent",
      label: "Excellent (<30ms, <5ms jitter)",
      badgeClass:
        "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
      dotClass: "bg-emerald-500",
      description: "Optimal conditions for HD conferencing and low-latency ssh.",
    };
  }

  return {
    grade: "Good",
    label: "Good (30-80ms)",
    badgeClass:
      "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
    dotClass: "bg-blue-500",
    description: "Solid performance for normal calls, Slack, and browsing.",
  };
}

/**
 * Resolves current connection type from navigator.connection API if available.
 */
export function getClientConnectionType(): string {
  if (typeof navigator !== "undefined" && "connection" in navigator) {
    const navConn = (
      navigator as unknown as {
        connection?: { type?: string; effectiveType?: string };
      }
    ).connection;
    return navConn?.effectiveType || navConn?.type || "wifi";
  }
  return "wifi";
}

export interface NetworkQualityWidgetProps {
  samples?: NetworkSample[];
  initialMedianRtt?: number;
  initialJitter?: number;
  initialPacketLoss?: number;
  venueId?: string;
  venueName?: string;
  connectionType?: string;
  onDownloadDiagnostics?: (diagnostics: NetworkDiagnosticsData) => void;
  className?: string;
  testId?: string;
}

export function NetworkQualityWidget({
  samples: propSamples,
  initialMedianRtt,
  initialJitter,
  initialPacketLoss,
  venueId,
  venueName = "Workspace Venue",
  connectionType: propConnectionType,
  onDownloadDiagnostics,
  className = "",
  testId = "network-quality-widget",
}: NetworkQualityWidgetProps) {
  // Generate realistic baseline samples if not provided
  const samples = useMemo<NetworkSample[]>(() => {
    if (propSamples && propSamples.length > 0) return propSamples;

    const now = Date.now();
    const baseRtt = initialMedianRtt ?? 22;
    const baseJitter = initialJitter ?? 2.5;

    // 12 samples over the last 60 seconds
    return Array.from({ length: 12 }, (_, i) => {
      const variation = (Math.sin(i) * baseJitter);
      const isLost = i === 11 && (initialPacketLoss ?? 0) > 0;
      return {
        timestamp: now - (11 - i) * 5000,
        rttMs: isLost ? null : Math.max(5, Number((baseRtt + variation).toFixed(1))),
        lost: isLost,
      };
    });
  }, [propSamples, initialMedianRtt, initialJitter, initialPacketLoss]);

  // Extract valid numeric RTTs
  const validRtts = useMemo(
    () =>
      samples
        .map((s) => s.rttMs)
        .filter((rtt): rtt is number => rtt !== null && !Number.isNaN(rtt)),
    [samples],
  );

  // Compute key metrics
  const medianRtt = useMemo(() => {
    if (initialMedianRtt !== undefined && (!propSamples || propSamples.length === 0)) {
      return initialMedianRtt;
    }
    return calculateMedian(validRtts);
  }, [initialMedianRtt, propSamples, validRtts]);

  const jitter = useMemo(() => {
    if (initialJitter !== undefined && (!propSamples || propSamples.length === 0)) {
      return initialJitter;
    }
    return calculateJitter(validRtts);
  }, [initialJitter, propSamples, validRtts]);

  const packetLoss = useMemo(() => {
    if (initialPacketLoss !== undefined && (!propSamples || propSamples.length === 0)) {
      return initialPacketLoss;
    }
    return calculatePacketLoss(samples, 60000);
  }, [initialPacketLoss, propSamples, samples]);

  const qualityInfo = useMemo(
    () => getNetworkQualityGrade(medianRtt, jitter, packetLoss),
    [medianRtt, jitter, packetLoss],
  );

  const connectionType = useMemo(
    () => propConnectionType || getClientConnectionType(),
    [propConnectionType],
  );

  // Diagnostics Export
  const handleDownloadDiagnostics = () => {
    const diagnosticsData: NetworkDiagnosticsData = {
      timestamp: new Date().toISOString(),
      connectionType,
      venueId,
      venueName,
      telemetryMetrics: {
        medianRttMs: medianRtt,
        jitterMs: jitter,
        packetLossPercentage: packetLoss,
        qualityGrade: qualityInfo.grade,
        qualityLabel: qualityInfo.label,
        sampleCount: samples.length,
        rollingWindowSeconds: 60,
        samples,
      },
    };

    onDownloadDiagnostics?.(diagnosticsData);

    const jsonString = JSON.stringify(diagnosticsData, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `network-diagnostics-${venueId || "telemetry"}-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      data-testid={testId}
      className={`bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6 shadow-sm flex flex-col justify-between space-y-5 ${className}`}
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20">
            <Radio className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <span>Network Latency & Jitter</span>
              <span className="text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
                ({connectionType.toUpperCase()})
              </span>
            </h4>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              60-second rolling telemetry diagnostics for {venueName}
            </p>
          </div>
        </div>

        {/* Quality Grade Badge */}
        <div className="flex items-center">
          <span
            data-testid="network-quality-badge"
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border transition-colors ${qualityInfo.badgeClass}`}
          >
            <span
              className={`h-2 w-2 rounded-full ${qualityInfo.dotClass} animate-pulse`}
            />
            <span>{qualityInfo.grade}</span>
          </span>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-3 gap-3">
        {/* Median RTT */}
        <div
          data-testid="metric-median-rtt"
          className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800/80 text-center"
        >
          <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-500 dark:text-zinc-400 block">
            Median RTT
          </span>
          <div className="text-xl sm:text-2xl font-black font-mono text-zinc-900 dark:text-zinc-100 mt-0.5">
            {medianRtt}
            <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400 ml-1">
              ms
            </span>
          </div>
          <span className="text-[10px] text-zinc-400 font-mono block mt-0.5">
            Round Trip Time
          </span>
        </div>

        {/* Jitter */}
        <div
          data-testid="metric-jitter"
          className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800/80 text-center"
        >
          <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-500 dark:text-zinc-400 block">
            Jitter
          </span>
          <div className="text-xl sm:text-2xl font-black font-mono text-zinc-900 dark:text-zinc-100 mt-0.5">
            ±{jitter}
            <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400 ml-1">
              ms
            </span>
          </div>
          <span className="text-[10px] text-zinc-400 font-mono block mt-0.5">
            Mean Variance
          </span>
        </div>

        {/* Packet Loss */}
        <div
          data-testid="metric-packet-loss"
          className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800/80 text-center"
        >
          <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-500 dark:text-zinc-400 block">
            Packet Loss
          </span>
          <div className="text-xl sm:text-2xl font-black font-mono text-zinc-900 dark:text-zinc-100 mt-0.5">
            {packetLoss}
            <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400 ml-1">
              %
            </span>
          </div>
          <span className="text-[10px] text-zinc-400 font-mono block mt-0.5">
            60s Window
          </span>
        </div>
      </div>

      {/* Grade Details & Action Footer */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-zinc-100 dark:border-zinc-800/80">
        <p className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
          {qualityInfo.description}
        </p>

        {/* Download Diagnostics Button */}
        <button
          type="button"
          onClick={handleDownloadDiagnostics}
          data-testid="download-diagnostics-btn"
          aria-label="Download Diagnostics JSON"
          className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold font-mono tracking-tight bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 transition-all shadow-sm active:scale-95 cursor-pointer whitespace-nowrap"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Download Diagnostics</span>
        </button>
      </div>
    </div>
  );
}

export default NetworkQualityWidget;
