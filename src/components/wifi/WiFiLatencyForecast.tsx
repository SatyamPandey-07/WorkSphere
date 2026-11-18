"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Area,
  AreaChart,
} from "recharts";
import {
  Wifi,
  Clock,
  TrendingUp,
  AlertTriangle,
  RotateCw,
  Video,
} from "lucide-react";
import { useWiFiLatency } from "@/hooks/useWiFiLatency";

export interface PingStats {
  samples: (number | null)[];
  successfulCount: number;
  totalSamples: number;
  meanLatency: number;
  jitter: number;
  packetLossPct: number;
  isCallReady: boolean;
  qualityLabel: "Zoom/Meet Ready" | "Poor for Calls";
  healthBadgeText: string;
}

export interface WiFiLatencyForecastProps {
  venueId: string;
  venueName: string;
  historicalLatency?: number[];
  historicalPacketLoss?: number[];
  weatherScore?: number;
  eventImpact?: number;
  currentLoad?: number;
  pingEndpoint?: string;
  autoTest?: boolean;
  initialPingStats?: PingStats;
  onTestComplete?: (stats: PingStats) => void;
}

/**
 * Computes mean latency, standard deviation (jitter in ms), and packet loss percentage
 * across sample HTTP HEAD pings.
 */
export function computePingStats(
  samples: (number | null)[],
  totalSamples: number = 5,
): PingStats {
  const valid = samples.filter(
    (s): s is number =>
      s !== null && typeof s === "number" && !isNaN(s) && s >= 0,
  );
  const total = totalSamples > 0 ? totalSamples : samples.length || 5;
  const failed = total - valid.length;
  const packetLossPct = Math.max(
    0,
    Math.min(100, Math.round((failed / total) * 100)),
  );

  if (valid.length === 0) {
    return {
      samples,
      successfulCount: 0,
      totalSamples: total,
      meanLatency: 0,
      jitter: 0,
      packetLossPct: 100,
      isCallReady: false,
      qualityLabel: "Poor for Calls",
      healthBadgeText: "Poor for Calls - 100% Loss",
    };
  }

  const sum = valid.reduce((acc, val) => acc + val, 0);
  const meanLatency = Number((sum / valid.length).toFixed(1));

  // Population standard deviation (jitter in ms)
  const variance =
    valid.reduce((acc, val) => acc + Math.pow(val - meanLatency, 2), 0) /
    valid.length;
  const jitter = Number(Math.sqrt(variance).toFixed(1));

  // Video call ready criteria: Jitter < 15ms, 0% packet loss, mean latency <= 100ms
  const isCallReady = jitter < 15 && packetLossPct === 0 && meanLatency <= 100;
  const qualityLabel: "Zoom/Meet Ready" | "Poor for Calls" = isCallReady
    ? "Zoom/Meet Ready"
    : "Poor for Calls";

  let healthBadgeText: string;
  if (isCallReady) {
    healthBadgeText =
      jitter < 10
        ? "Call Ready - Jitter < 10ms"
        : `Call Ready - Jitter ${jitter}ms`;
  } else {
    if (packetLossPct > 0) {
      healthBadgeText = `Poor for Calls - ${packetLossPct}% Loss`;
    } else if (jitter >= 15) {
      healthBadgeText = `Poor for Calls - Jitter ${jitter}ms`;
    } else {
      healthBadgeText = `Poor for Calls - Latency ${meanLatency}ms`;
    }
  }

  return {
    samples,
    successfulCount: valid.length,
    totalSamples: total,
    meanLatency,
    jitter,
    packetLossPct,
    isCallReady,
    qualityLabel,
    healthBadgeText,
  };
}

/**
 * Measures consecutive HTTP HEAD ping samples against a low-overhead endpoint.
 */
export async function measurePingSamples(
  endpoint: string = "/api/telemetry/speedtest",
  sampleCount: number = 5,
  signal?: AbortSignal,
): Promise<(number | null)[]> {
  const samples: (number | null)[] = [];
  const getTimestamp = () =>
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();

  for (let i = 0; i < sampleCount; i++) {
    if (signal?.aborted) break;
    const start = getTimestamp();
    try {
      const separator = endpoint.includes("?") ? "&" : "?";
      const url = `${endpoint}${separator}probe=${i}&t=${Date.now()}`;
      const res = await fetch(url, {
        method: "HEAD",
        cache: "no-store",
        signal,
      });
      if (!res.ok && res.status !== 304) {
        samples.push(null);
      } else {
        const duration = Math.max(0, getTimestamp() - start);
        samples.push(duration);
      }
    } catch {
      samples.push(null);
    }
  }

  return samples;
}

function formatHour(hour: number): string {
  const h = hour % 12 || 12;
  const ampm = hour < 12 ? "a" : "p";
  return `${h}${ampm}`;
}

function getLatencyQuality(latency: number): {
  label: string;
  color: string;
} {
  if (latency < 25) return { label: "Excellent", color: "text-emerald-500" };
  if (latency < 50) return { label: "Good", color: "text-amber-500" };
  return { label: "Poor", color: "text-rose-500" };
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="bg-zinc-900/95 dark:bg-black/95 backdrop-blur-xl border border-zinc-700 rounded-xl p-3 shadow-2xl">
      <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-2">
        {label ? formatHour(parseInt(label)) : "Now"}
      </p>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span
            className="w-2 h-2 rounded-full"
            style={{
              backgroundColor: entry.name === "latency" ? "#3b82f6" : "#f59e0b",
            }}
          />
          <span className="text-zinc-400 capitalize">{entry.name}:</span>
          <span className="font-bold text-white">
            {entry.value.toFixed(1)}
            {entry.name === "latency" ? "ms" : "%"}
          </span>
        </div>
      ))}
    </div>
  );
}

function MachSpeedDial({ latency }: { latency: number }) {
  // Convert latency to approximate simulated throughput & Mach rating
  // Latency < 20ms => ~300+ Mbps (Mach 3.0+)
  // Latency 20-50ms => ~150-250 Mbps (Mach 1.5 - 2.5)
  // Latency 50-100ms => ~50-150 Mbps (Mach 0.5 - 1.5)
  // Latency > 100ms => <50 Mbps (Mach 0.1 - 0.5)
  const estimatedMbps = Math.max(10, Math.min(350, Math.round(5000 / Math.max(10, latency))));
  const machSpeed = Math.min(3.2, Math.max(0.1, Number((estimatedMbps / 100).toFixed(2))));
  
  // Needle rotation angle: Mach 0 = -120deg, Mach 3 = +120deg (Total sweep = 240deg)
  const needleAngle = Math.min(120, Math.max(-120, -120 + (machSpeed / 3.0) * 240));

  return (
    <div
      role="meter"
      aria-label="WiFi Mach speed throughput meter"
      aria-valuenow={machSpeed}
      aria-valuemin={0}
      aria-valuemax={3}
      aria-valuetext={`Mach ${machSpeed.toFixed(2)} (${estimatedMbps} Mbps equivalent)`}
      className="flex flex-col items-center justify-center p-3 rounded-2xl bg-[#04100c]/80 dark:bg-zinc-950/80 border border-emerald-500/25 shadow-lg shadow-emerald-950/30 text-emerald-400"
    >
      <div className="relative w-28 h-28 flex items-center justify-center">
        <svg viewBox="0 0 100 100" className="w-full h-full">
          {/* Outer Gauge Bezel */}
          <circle cx="50" cy="50" r="44" stroke="rgba(16, 185, 129, 0.2)" strokeWidth="3" fill="none" />
          
          {/* Arc Background: Subsonic to Supersonic Track */}
          <path
            d="M 20 80 A 40 40 0 1 1 80 80"
            fill="none"
            stroke="rgba(16, 185, 129, 0.2)"
            strokeWidth="5"
            strokeLinecap="round"
          />

          {/* Afterburner Redline Zone (Mach 2.5 to 3.0) */}
          <path
            d="M 68 28 A 40 40 0 0 1 80 80"
            fill="none"
            stroke="#ef4444"
            strokeWidth="5"
            strokeLinecap="round"
          />

          {/* Major Tick Marks */}
          {/* M0.0 */}
          <line x1="22" y1="78" x2="28" y2="74" stroke="#10b981" strokeWidth="2" />
          {/* M1.0 */}
          <line x1="22" y1="28" x2="28" y2="34" stroke="#10b981" strokeWidth="2" />
          {/* M2.0 */}
          <line x1="78" y1="28" x2="72" y2="34" stroke="#10b981" strokeWidth="2" />
          {/* M3.0 */}
          <line x1="78" y1="78" x2="72" y2="74" stroke="#ef4444" strokeWidth="2" />

          {/* Text Labels */}
          <text x="50" y="32" textAnchor="middle" fill="#34d399" fontSize="7" fontWeight="bold" fontFamily="monospace">
            MACH
          </text>
          <text x="27" y="85" textAnchor="middle" fill="#a1a1aa" fontSize="6" fontFamily="monospace">
            0
          </text>
          <text x="18" y="32" textAnchor="middle" fill="#a1a1aa" fontSize="6" fontFamily="monospace">
            1
          </text>
          <text x="82" y="32" textAnchor="middle" fill="#a1a1aa" fontSize="6" fontFamily="monospace">
            2
          </text>
          <text x="73" y="85" textAnchor="middle" fill="#ef4444" fontSize="6" fontWeight="bold" fontFamily="monospace">
            3+
          </text>

          {/* Animated Gauge Needle */}
          <g
            style={{
              transform: `rotate(${needleAngle}deg)`,
              transformOrigin: "50px 50px",
              transition: "transform 1s cubic-bezier(0.34, 1.56, 0.64, 1)",
            }}
          >
            {/* Needle Shaft */}
            <line x1="50" y1="50" x2="50" y2="16" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" />
            <polygon points="50,12 47,19 53,19" fill="#34d399" />
          </g>

          {/* Center Hub */}
          <circle cx="50" cy="50" r="4.5" fill="#04100c" stroke="#10b981" strokeWidth="2" />
        </svg>

        {/* Digital Readout */}
        <div className="absolute bottom-2 inset-x-0 text-center font-mono">
          <span className="text-[11px] font-black text-white">M {machSpeed.toFixed(2)}</span>
          <span className="text-[9px] text-zinc-400 block -mt-0.5">~{estimatedMbps} Mbps</span>
        </div>
      </div>
    </div>
  );
}

export function WiFiLatencyForecast({
  venueId,
  venueName,
  historicalLatency,
  historicalPacketLoss,
  weatherScore,
  eventImpact,
  currentLoad,
  pingEndpoint = "/api/telemetry/speedtest",
  autoTest = true,
  initialPingStats,
  onTestComplete,
}: WiFiLatencyForecastProps) {
  const { predictions, isLoading, predict } = useWiFiLatency({
    venueId,
    historicalLatency,
    historicalPacketLoss,
    weatherScore,
    eventImpact,
    currentLoad,
  });

  const [pingStats, setPingStats] = useState<PingStats | null>(
    () => initialPingStats ?? null,
  );
  const [isTesting, setIsTesting] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const runPingTest = useCallback(async () => {
    if (typeof window === "undefined" || typeof fetch !== "function") return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsTesting(true);
    try {
      const rawSamples = await measurePingSamples(
        pingEndpoint,
        5,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        const stats = computePingStats(rawSamples, 5);
        setPingStats(stats);
        onTestComplete?.(stats);
      }
    } catch {
      // Aborted or fetch error
    } finally {
      if (!controller.signal.aborted) {
        setIsTesting(false);
      }
    }
  }, [pingEndpoint, onTestComplete]);

  useEffect(() => {
    if (autoTest && !initialPingStats) {
      void runPingTest();
    }
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [autoTest, initialPingStats, runPingTest]);

  if (isLoading && !predictions) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/60 shadow-md">
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
          <span className="text-xs font-bold text-zinc-500">
            Loading WiFi predictions...
          </span>
        </div>
      </div>
    );
  }

  if (!predictions) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/60 shadow-md">
        <p className="text-xs text-zinc-400">No prediction data available</p>
      </div>
    );
  }

  const chartData = predictions.hourlyLatency.map((latency, i) => ({
    hour: i.toString(),
    latency,
    packetLoss: predictions.hourlyPacketLoss[i],
  }));

  const currentHour = new Date().getHours();
  const currentLatency = predictions.hourlyLatency[currentHour] ?? 0;
  const quality = getLatencyQuality(currentLatency);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/60 shadow-md">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-150 dark:border-zinc-850">
        <div>
          <p className="font-bold text-sm tracking-tight text-zinc-900 dark:text-zinc-50 uppercase flex items-center gap-1.5">
            <Wifi className="w-4 h-4 text-emerald-500" />
            WiFi Latency & Mach Airspeed Forecast
          </p>
          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            24-hour prediction for {venueName}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <MachSpeedDial latency={currentLatency} />
          <div className="flex flex-col items-end">
            <span className={`text-xs font-black ${quality.color}`}>
              {quality.label}
            </span>
            <span className="text-[10px] text-zinc-400">
              ({currentLatency.toFixed(0)}ms ping)
            </span>
          </div>
        </div>
      </div>

      {/* Latency line graph */}
      <div className="mt-4 h-48">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="latencyGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(113,113,122,0.15)"
            />
            <XAxis
              dataKey="hour"
              tickFormatter={formatHour}
              tick={{ fontSize: 9, fill: "#71717a" }}
              axisLine={false}
              tickLine={false}
              interval={3}
            />
            <YAxis
              tick={{ fontSize: 9, fill: "#71717a" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `${v}ms`}
              width={40}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="latency"
              stroke="#3b82f6"
              strokeWidth={2}
              fill="url(#latencyGradient)"
              dot={false}
              activeDot={{ r: 4, fill: "#3b82f6" }}
            />
            <ReferenceLine
              x={currentHour.toString()}
              stroke="#f43f5e"
              strokeDasharray="4 4"
              label={{
                value: "Now",
                position: "top",
                fill: "#f43f5e",
                fontSize: 9,
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Stats row */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="p-2 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700 text-center">
          <p className="text-[9px] font-black uppercase tracking-widest text-zinc-400">
            Best Time
          </p>
          <p className="text-sm font-black text-emerald-500 mt-0.5">
            {formatHour(predictions.bestTimeSlot.hour)}
          </p>
          <p className="text-[10px] text-zinc-400">
            {predictions.bestTimeSlot.latency.toFixed(0)}ms
          </p>
        </div>
        <div className="p-2 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700 text-center">
          <p className="text-[9px] font-black uppercase tracking-widest text-zinc-400">
            Peak Hours
          </p>
          <p className="text-sm font-black text-amber-500 mt-0.5">
            {predictions.peakHours.length}
          </p>
          <p className="text-[10px] text-zinc-400">
            {predictions.peakHours.length > 0
              ? `${formatHour(predictions.peakHours[0])}-${formatHour(predictions.peakHours[predictions.peakHours.length - 1])}`
              : "None"}
          </p>
        </div>
        <div className="p-2 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700 text-center">
          <p className="text-[9px] font-black uppercase tracking-widest text-zinc-400">
            Confidence
          </p>
          <p className="text-sm font-black text-blue-500 mt-0.5">
            {(predictions.confidence * 100).toFixed(0)}%
          </p>
          <p className="text-[10px] text-zinc-400">ML model</p>
        </div>
      </div>

      {/* Peak hours warning */}
      {predictions.peakHours.includes(currentHour) && (
        <div className="mt-3 p-2 rounded-lg border border-amber-500/20 bg-amber-500/10 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400">
            Peak congestion hours. Best to avoid bandwidth-heavy tasks.
          </span>
        </div>
      )}

      {/* Best time recommendation */}
      {predictions.bestTimeSlot.hour === currentHour && (
        <div className="mt-3 p-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 flex items-center gap-2">
          <Clock className="w-4 h-4 text-emerald-500 shrink-0" />
          <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
            Great time for bandwidth-heavy work! WiFi is at its best right now.
          </span>
        </div>
      )}

      {/* Client-side Live Video Call Quality & Jitter Metrics */}
      <div className="mt-4 p-3 rounded-xl bg-white dark:bg-zinc-800/80 border border-zinc-200/80 dark:border-zinc-700/80 shadow-sm">
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <div className="flex items-center gap-1.5">
            <Video className="w-3.5 h-3.5 text-blue-500" />
            <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider">
              Client Video Call Health
            </span>
          </div>
          <button
            onClick={() => void runPingTest()}
            disabled={isTesting}
            aria-label="Re-test connection"
            data-testid="retest-ping-btn"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-lg text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white bg-zinc-100 dark:bg-zinc-700/60 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50"
          >
            <RotateCw
              className={`w-3 h-3 ${isTesting ? "animate-spin text-blue-500" : ""}`}
            />
            <span>
              {isTesting ? "Testing (5 pings)..." : "Re-test Connection"}
            </span>
          </button>
        </div>

        {/* Visual Connection Quality Indicator & Health Badge */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                isTesting
                  ? "bg-amber-400 animate-pulse"
                  : pingStats?.isCallReady
                    ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                    : "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]"
              }`}
            />
            <span
              data-testid="connection-quality-indicator"
              className={`text-xs font-bold ${
                isTesting
                  ? "text-zinc-500 dark:text-zinc-400"
                  : pingStats?.isCallReady
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-rose-600 dark:text-rose-400"
              }`}
            >
              {isTesting
                ? "Measuring 5 HTTP HEAD pings..."
                : (pingStats?.qualityLabel ?? "Unmeasured")}
            </span>
          </div>

          {pingStats && !isTesting && (
            <span
              data-testid="health-badge"
              role="status"
              className={`text-[10px] font-black tracking-wide px-2.5 py-0.5 rounded-full border ${
                pingStats.isCallReady
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                  : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30"
              }`}
            >
              {pingStats.healthBadgeText}
            </span>
          )}
        </div>

        {/* 3 Metrics: Mean Latency, Jitter (Std Dev), Packet Loss */}
        <div className="mt-2.5 grid grid-cols-3 gap-2 text-center">
          <div className="p-2 rounded-lg bg-zinc-50/60 dark:bg-zinc-900/40 border border-zinc-100 dark:border-zinc-800/80">
            <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">
              Mean Latency
            </p>
            <p
              data-testid="mean-latency-value"
              className="text-xs font-extrabold text-zinc-800 dark:text-zinc-200 mt-0.5"
            >
              {pingStats ? `${pingStats.meanLatency}ms` : "--"}
            </p>
          </div>
          <div className="p-2 rounded-lg bg-zinc-50/60 dark:bg-zinc-900/40 border border-zinc-100 dark:border-zinc-800/80">
            <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">
              Jitter (Std Dev)
            </p>
            <p
              data-testid="jitter-value"
              className="text-xs font-extrabold text-zinc-800 dark:text-zinc-200 mt-0.5"
            >
              {pingStats ? `${pingStats.jitter}ms` : "--"}
            </p>
          </div>
          <div className="p-2 rounded-lg bg-zinc-50/60 dark:bg-zinc-900/40 border border-zinc-100 dark:border-zinc-800/80">
            <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">
              Packet Loss
            </p>
            <p
              data-testid="packet-loss-value"
              className="text-xs font-extrabold text-zinc-800 dark:text-zinc-200 mt-0.5"
            >
              {pingStats ? `${pingStats.packetLossPct}%` : "--"}
            </p>
          </div>
        </div>
      </div>

      <button
        onClick={predict}
        className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-xs font-bold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
      >
        <TrendingUp className="w-3.5 h-3.5" />
        Refresh Prediction
      </button>
    </div>
  );
}
