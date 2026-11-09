"use client";

import React, { useState, useRef } from "react";
import {
  Activity,
  Zap,
  ArrowDown,
  ArrowUp,
  ShieldCheck,
  Play,
  Square,
  Copy,
  Check,
  Radio,
  Server,
  Sparkles,
  Gauge,
} from "lucide-react";
import {
  SpeedBenchmarkRunner,
  type BenchmarkMetrics,
  type BenchmarkProgress,
  type BufferbloatGrade,
  getBufferbloatRating,
  calculateBufferbloatGrade,
} from "@/lib/wifi/speedBenchmarkEngine";

interface ProofOfBandwidthModalProps {
  venueId?: string;
  venueName?: string;
  onBenchmarkComplete?: (metrics: BenchmarkMetrics) => void;
}

export function formatSpeed(mbps: number | null | undefined): string {
  if (mbps == null || !Number.isFinite(mbps) || mbps <= 0) {
    return "0.0";
  }
  return mbps.toFixed(1);
}

export function formatJitter(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) {
    return "--";
  }
  return ms.toFixed(1);
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) {
    return "--";
  }
  return ms.toFixed(1);
}

export function formatLatencyDelta(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) {
    return "--";
  }
  return `+${ms.toFixed(1)}`;
}

/**
 * Safe fallback for bufferbloat rating descriptions to guarantee stability
 * even if engine functions are partially mocked in isolated test runners.
 */
function safeGetBufferbloatRating(grade?: BufferbloatGrade | null) {
  if (typeof getBufferbloatRating === "function" && grade) {
    try {
      return getBufferbloatRating(grade);
    } catch {
      // fallback to built-in table
    }
  }

  switch (grade) {
    case "A+":
      return {
        grade: "A+" as const,
        label: "Exceptional · Minimal Buffer Queueing",
        color: "text-emerald-400 bg-emerald-500/15 border-emerald-500/30",
        description:
          "Near-zero packet delay under peak load. Ideal for 4K video calls, live screen shares, and competitive gaming.",
      };
    case "A":
      return {
        grade: "A" as const,
        label: "Great · Low Latency Growth",
        color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
        description:
          "Minimal ping increase during large file transfers. Calls remain crystal-clear without voice stutter.",
      };
    case "B":
      return {
        grade: "B" as const,
        label: "Good · Moderate Queue Delay",
        color: "text-blue-400 bg-blue-500/10 border-blue-500/30",
        description:
          "Slight ping jitter under heavy traffic; suitable for general conferencing, Slack huddles, and web work.",
      };
    case "C":
      return {
        grade: "C" as const,
        label: "Fair · Noticeable Call Lag Under Load",
        color: "text-amber-400 bg-amber-500/10 border-amber-500/30",
        description:
          "Packets queue up during downloads. Video calls may experience hitching when others download heavy assets.",
      };
    case "D":
      return {
        grade: "D" as const,
        label: "Poor · High Buffer Bloat",
        color: "text-orange-400 bg-orange-500/10 border-orange-500/30",
        description:
          "Significant latency increase under load (>60ms). Audio may drop out and video freezes during file transfers.",
      };
    case "F":
      return {
        grade: "F" as const,
        label: "Severe · Video Calls Will Freeze",
        color: "text-rose-400 bg-rose-500/10 border-rose-500/30",
        description:
          "Extreme packet queueing (>150ms delay). Simultaneous streaming and video calling will freeze or drop.",
      };
    default:
      return {
        grade: (grade ?? "B") as BufferbloatGrade,
        label: "Unrated · Baseline Queue Measurement",
        color: "text-slate-400 bg-slate-800/40 border-slate-700",
        description:
          "Measures packet queue delay and latency degradation under network traffic saturation.",
      };
  }
}

export default function ProofOfBandwidthModal({
  venueId = "sample-venue-sf",
  venueName = "Workshop Cafe SoMa",
  onBenchmarkComplete,
}: ProofOfBandwidthModalProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<BenchmarkProgress>({
    phase: "idle",
    currentProgressPct: 0,
  });
  const [metrics, setMetrics] = useState<BenchmarkMetrics | null>(null);
  const [verifiedBadgeCode, setVerifiedBadgeCode] = useState<string | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  const [, setSubmitting] = useState(false);

  const runnerRef = useRef<SpeedBenchmarkRunner | null>(null);

  const handleStartTest = async () => {
    setIsRunning(true);
    setMetrics(null);
    setVerifiedBadgeCode(null);
    setProgress({ phase: "latency", currentProgressPct: 0 });

    runnerRef.current = new SpeedBenchmarkRunner();

    try {
      const results = await runnerRef.current.runBenchmark((p) => {
        setProgress(p);
      });

      setMetrics(results);
      onBenchmarkComplete?.(results);

      // Submit verified results to telemetry endpoint
      setSubmitting(true);
      try {
        const res = await fetch("/api/telemetry/speedtest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            venueId,
            downloadMbps: results.downloadMbps,
            uploadMbps: results.uploadMbps,
            latencyMs: results.latencyMs,
            jitterMs: results.jitterMs,
            bufferbloatGrade: results.bufferbloatGrade,
            latencyUnderLoadMs: results.latencyUnderLoadMs,
            bufferbloatDeltaMs: results.bufferbloatDeltaMs,
            crowdLevel: "moderate",
          }),
        });
        const data = await res.json();
        if (data.success && data.verifiedBadge) {
          setVerifiedBadgeCode(data.verifiedBadge.badgeCode);
        }
      } catch (err) {
        console.error("Failed to submit telemetry:", err);
      } finally {
        setSubmitting(false);
      }
    } catch (err: any) {
      if (err.message !== "Benchmark aborted") {
        console.error("Benchmark error:", err);
      }
    } finally {
      setIsRunning(false);
    }
  };

  const handleCancelTest = () => {
    if (runnerRef.current) {
      runnerRef.current.cancel();
    }
    setIsRunning(false);
    setProgress({ phase: "idle", currentProgressPct: 0 });
  };

  const handleCopyBadge = () => {
    if (verifiedBadgeCode) {
      navigator.clipboard.writeText(verifiedBadgeCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const getTierDetails = (tier: BenchmarkMetrics["tier"]) => {
    switch (tier) {
      case "4K_CONFERENCING":
        return {
          title: "⚡ 4K Call & Screen Share Certified",
          color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
          desc: "Flawless for multi-person video calls, heavy code deploys, and Figma streaming.",
        };
      case "HD_CONFERENCING":
        return {
          title: "🎥 HD Video Calling Ready",
          color: "text-blue-400 bg-blue-500/10 border-blue-500/30",
          desc: "Stable for Google Meet / Zoom with low jitter.",
        };
      case "STANDARD_BROWSING":
        return {
          title: "🌐 Standard Web & Slack",
          color: "text-amber-400 bg-amber-500/10 border-amber-500/30",
          desc: "Good for general asynchronous remote work and documentation.",
        };
      case "UNSTABLE":
      default:
        return {
          title: "⚠️ High Jitter / Throttled",
          color: "text-rose-400 bg-rose-500/10 border-rose-500/30",
          desc: "High packet latency detected; caution on live client calls.",
        };
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto rounded-3xl bg-slate-900/90 border border-slate-800 p-6 md:p-8 space-y-6 backdrop-blur-xl shadow-2xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-semibold uppercase tracking-wider">
            <Radio className="w-3.5 h-3.5 animate-pulse" /> Proof-of-Bandwidth
            Verifier
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight">
            Wi-Fi Speed, Jitter & Bufferbloat Benchmark
          </h2>
          <p className="text-xs text-slate-400 flex items-center gap-1.5">
            <Server className="w-3.5 h-3.5 text-indigo-400" />
            Testing Network for:{" "}
            <strong className="text-slate-200">{venueName}</strong>
          </p>
        </div>

        <div>
          {isRunning ? (
            <button
              onClick={handleCancelTest}
              className="px-4 py-2 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/40 text-xs font-semibold flex items-center gap-1.5 transition"
            >
              <Square className="w-3.5 h-3.5 fill-current" /> Stop Test
            </button>
          ) : (
            <button
              onClick={handleStartTest}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-blue-600/30 flex items-center gap-2 transition"
            >
              <Play className="w-3.5 h-3.5 fill-current" /> Run Benchmark
            </button>
          )}
        </div>
      </div>

      {/* Main Gauge Visualizer */}
      <div className="relative p-6 rounded-2xl bg-slate-950/70 border border-slate-800/80 flex flex-col items-center justify-center space-y-4">
        {/* Speedometer Center Display */}
        <div className="flex flex-col items-center justify-center text-center space-y-1">
          <span className="text-xs font-mono uppercase tracking-widest text-slate-400">
            {isRunning
              ? progress.phase === "bufferbloat"
                ? "Phase: BUFFERBLOAT (LOADED LATENCY)"
                : `Phase: ${progress.phase.toUpperCase()}`
              : metrics
                ? "Verified Throughput"
                : "Ready to Test"}
          </span>

          <div className="flex items-baseline gap-2">
            <span className="text-5xl md:text-6xl font-black tracking-tight text-white font-mono">
              {isRunning
                ? progress.phase === "bufferbloat"
                  ? progress.currentLoadedPingMs ?? progress.currentPingMs ?? "..."
                  : progress.instantaneousSpeedMbps != null &&
                    Number.isFinite(progress.instantaneousSpeedMbps)
                    ? formatSpeed(progress.instantaneousSpeedMbps)
                    : (progress.currentPingMs ?? "...")
                : metrics
                  ? formatSpeed(metrics.downloadMbps)
                  : "--"}
            </span>
            <span className="text-sm font-bold text-blue-400 font-mono">
              {isRunning && (progress.phase === "latency" || progress.phase === "bufferbloat")
                ? "ms"
                : "Mbps"}
            </span>
          </div>

          <span className="text-xs text-slate-500">
            {isRunning
              ? progress.phase === "bufferbloat"
                ? "Measuring loaded packet latency under bidirectional saturation..."
                : "Running multi-stream packet latency & throughput sampler..."
              : metrics
                ? `Stability Index: ${metrics.stabilityScore}/100`
                : "Tests upload, download, latency, jitter, and bufferbloat"}
          </span>
        </div>

        {/* Progress Bar */}
        {isRunning && (
          <div className="w-full max-w-md space-y-1.5 pt-2">
            <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-400 transition-all duration-200"
                style={{ width: `${progress.currentProgressPct}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span>Ping / Jitter</span>
              <span>Download Stream</span>
              <span>Upload Sink</span>
              <span>Bufferbloat</span>
            </div>
          </div>
        )}
      </div>

      {/* 4 Core Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-2xl bg-slate-800/40 border border-slate-800 space-y-1">
          <span className="text-[11px] text-slate-400 flex items-center gap-1">
            <ArrowDown className="w-3.5 h-3.5 text-blue-400" /> Download
          </span>
          <div className="text-lg font-bold text-white font-mono">
            {metrics ? `${formatSpeed(metrics.downloadMbps)} Mbps` : "--"}
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-slate-800/40 border border-slate-800 space-y-1">
          <span className="text-[11px] text-slate-400 flex items-center gap-1">
            <ArrowUp className="w-3.5 h-3.5 text-emerald-400" /> Upload
          </span>
          <div className="text-lg font-bold text-white font-mono">
            {metrics ? `${formatSpeed(metrics.uploadMbps)} Mbps` : "--"}
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-slate-800/40 border border-slate-800 space-y-1">
          <span className="text-[11px] text-slate-400 flex items-center gap-1">
            <Activity className="w-3.5 h-3.5 text-amber-400" /> Latency (Ping)
          </span>
          <div className="text-lg font-bold text-white font-mono">
            {metrics ? `${metrics.latencyMs} ms` : "--"}
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-slate-800/40 border border-slate-800 space-y-1">
          <span className="text-[11px] text-slate-400 flex items-center gap-1">
            <Zap className="w-3.5 h-3.5 text-purple-400" /> Jitter
          </span>
          <div className="text-lg font-bold text-white font-mono">
            {metrics && metrics.meanJitterMs != null
              ? `${formatJitter(metrics.meanJitterMs)} ms`
              : "--"}
          </div>
          {metrics && (
            <div className="text-[10px] text-slate-500 font-mono">
              {`RFC 3550: ±${metrics.jitterMs} ms`}
            </div>
          )}
        </div>
      </div>

      {/* Bufferbloat & Latency Under Load Benchmark Tile */}
      <div
        data-testid="bufferbloat-tile"
        className="p-4 sm:p-5 rounded-2xl bg-slate-950/70 border border-slate-800/80 space-y-3.5 backdrop-blur-sm shadow-inner"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Gauge className="w-4 h-4 text-cyan-400" />
              <h4 className="text-sm font-bold text-white tracking-tight">
                Bufferbloat & Latency Under Load
              </h4>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                Queue Delay Analysis
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Evaluates packet queue delay when network traffic is saturated under bidirectional load.
            </p>
          </div>

          {/* Letter Grade Badge */}
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <div
              data-testid="bufferbloat-grade-badge"
              className={`px-3 py-1.5 rounded-xl border font-mono text-xs flex items-center gap-1.5 shadow-sm transition-all ${
                metrics?.bufferbloatGrade
                  ? safeGetBufferbloatRating(metrics.bufferbloatGrade).color
                  : isRunning && progress.currentBufferbloatGrade
                    ? safeGetBufferbloatRating(progress.currentBufferbloatGrade).color
                    : "text-slate-400 bg-slate-900 border-slate-800"
              }`}
            >
              <span className="font-sans font-semibold uppercase tracking-wider text-slate-400 text-[10px]">
                Grade:
              </span>
              <span className="text-sm font-black">
                {metrics?.bufferbloatGrade ?? progress.currentBufferbloatGrade ?? "--"}
              </span>
            </div>
          </div>
        </div>

        {/* Sub-metrics: Loaded Latency, Delta, and Stream Saturation */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
          <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/60">
            <span className="text-[10px] uppercase font-mono text-slate-400 block">
              Latency Under Load
            </span>
            <div
              data-testid="latency-under-load-readout"
              className="text-base font-bold text-white font-mono mt-0.5"
            >
              {metrics?.latencyUnderLoadMs != null
                ? `${formatLatency(metrics.latencyUnderLoadMs)} ms`
                : progress.currentLoadedPingMs != null
                  ? `${formatLatency(progress.currentLoadedPingMs)} ms`
                  : "--"}
            </div>
            <span className="text-[10px] text-slate-500">Peak loaded ping</span>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/60">
            <span className="text-[10px] uppercase font-mono text-slate-400 block">
              Bufferbloat Delta (Δ)
            </span>
            <div
              data-testid="bufferbloat-delta-readout"
              className="text-base font-bold text-cyan-400 font-mono mt-0.5"
            >
              {metrics?.bufferbloatDeltaMs != null
                ? `${formatLatencyDelta(metrics.bufferbloatDeltaMs)} ms`
                : "--"}
            </div>
            <span className="text-[10px] text-slate-500">Added queue delay</span>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/60">
            <span className="text-[10px] uppercase font-mono text-slate-400 block">
              Download Under Load
            </span>
            <div className="text-base font-bold text-slate-200 font-mono mt-0.5">
              {metrics?.downloadLatencyMs != null
                ? `${formatLatency(metrics.downloadLatencyMs)} ms`
                : "--"}
            </div>
            <span className="text-[10px] text-slate-500">DL queue latency</span>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/60">
            <span className="text-[10px] uppercase font-mono text-slate-400 block">
              Upload Under Load
            </span>
            <div className="text-base font-bold text-slate-200 font-mono mt-0.5">
              {metrics?.uploadLatencyMs != null
                ? `${formatLatency(metrics.uploadLatencyMs)} ms`
                : "--"}
            </div>
            <span className="text-[10px] text-slate-500">UL queue latency</span>
          </div>
        </div>

        {/* Rating assessment description if results or active grade */}
        {(metrics?.bufferbloatGrade || progress.currentBufferbloatGrade) && (
          <div className="px-3.5 py-2 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs">
            <span className="font-semibold text-slate-200">
              {safeGetBufferbloatRating(metrics?.bufferbloatGrade ?? progress.currentBufferbloatGrade).label}
            </span>
            <span className="text-slate-400 text-[11px]">
              {safeGetBufferbloatRating(metrics?.bufferbloatGrade ?? progress.currentBufferbloatGrade).description}
            </span>
          </div>
        )}
      </div>

      {/* Verified Attestation Card */}
      {metrics && (
        <div className="space-y-4 pt-2">
          {(() => {
            const tierInfo = getTierDetails(metrics.tier);
            return (
              <div
                className={`p-4 rounded-2xl border ${tierInfo.color} space-y-2`}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4" /> {tierInfo.title}
                  </h3>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-black/30">
                    {metrics.stabilityScore}% Stability
                  </span>
                </div>
                <p className="text-xs opacity-90">{tierInfo.desc}</p>
              </div>
            );
          })()}

          {/* Cryptographic Badge Code */}
          {verifiedBadgeCode && (
            <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <div>
                  <span className="text-slate-400 block text-[10px]">
                    Verified Proof-of-Bandwidth Token
                  </span>
                  <code className="font-mono text-emerald-300 font-bold text-xs">
                    {verifiedBadgeCode}
                  </code>
                </div>
              </div>

              <button
                onClick={handleCopyBadge}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition shrink-0"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copied ? "Copied" : "Copy Badge"}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

