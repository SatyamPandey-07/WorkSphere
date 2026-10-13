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
} from "lucide-react";
import {
  SpeedBenchmarkRunner,
  type BenchmarkMetrics,
  type BenchmarkProgress,
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
            Wi-Fi Speed & RFC 3550 Jitter Benchmark
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
              ? `Phase: ${progress.phase.toUpperCase()}`
              : metrics
                ? "Verified Throughput"
                : "Ready to Test"}
          </span>

          <div className="flex items-baseline gap-2">
            <span className="text-5xl md:text-6xl font-black tracking-tight text-white font-mono">
              {isRunning
                ? progress.instantaneousSpeedMbps != null &&
                  Number.isFinite(progress.instantaneousSpeedMbps)
                  ? formatSpeed(progress.instantaneousSpeedMbps)
                  : (progress.currentPingMs ?? "...")
                : metrics
                  ? formatSpeed(metrics.downloadMbps)
                  : "--"}
            </span>
            <span className="text-sm font-bold text-blue-400 font-mono">
              {isRunning && progress.phase === "latency" ? "ms" : "Mbps"}
            </span>
          </div>

          <span className="text-xs text-slate-500">
            {isRunning
              ? "Running multi-stream packet latency & throughput sampler..."
              : metrics
                ? `Stability Index: ${metrics.stabilityScore}/100`
                : "Tests upload, download, latency, and packet jitter"}
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
