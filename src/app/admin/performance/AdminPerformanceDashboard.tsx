"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  Clock,
  Database,
  Globe,
  RefreshCw,
  ServerCrash,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PerformanceSummary } from "@/lib/performanceTelemetry";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMs(value: number) {
  if (!value) return "—";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

function formatHour(iso: string) {
  // iso: "2024-07-20T10"
  const [datePart, hourPart] = iso.split("T");
  const [, month, day] = datePart.split("-");
  return `${month}/${day} ${hourPart}h`;
}

function latencyColor(ms: number): string {
  if (ms <= 200) return "#34d399"; // green
  if (ms <= 500) return "#fbbf24"; // amber
  return "#f87171"; // red
}

// ─── Tooltip customisation ────────────────────────────────────────────────────

const tooltipStyle = {
  background: "#111114",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  color: "#e4e4e7",
  fontSize: 13,
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  accent = "violet",
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: "violet" | "cyan" | "amber" | "red" | "emerald";
}) {
  const accentMap = {
    violet: "bg-violet-500/10 text-violet-300 border-violet-400/20",
    cyan: "bg-cyan-500/10 text-cyan-300 border-cyan-400/20",
    amber: "bg-amber-500/10 text-amber-300 border-amber-400/20",
    red: "bg-red-500/10 text-red-300 border-red-400/20",
    emerald: "bg-emerald-500/10 text-emerald-300 border-emerald-400/20",
  };

  return (
    <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/10 backdrop-blur-xl">
      <div className="mb-5 flex items-center justify-between">
        <span className="text-sm text-zinc-400">{label}</span>
        <span className={`rounded-2xl border p-2.5 ${accentMap[accent]}`}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <p className="text-3xl font-semibold tracking-tight text-white">
        {value}
      </p>
      <p className="mt-2 text-xs text-zinc-500">{detail}</p>
    </article>
  );
}

function SectionHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <p className="mt-1 text-sm text-zinc-500">{description}</p>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-40 items-center justify-center text-sm text-zinc-600">
      {message}
    </div>
  );
}

// ─── Skeleton loader ──────────────────────────────────────────────────────────

function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded-2xl bg-white/[0.06] ${className}`} />
  );
}

// ─── Main dashboard ──────────────────────────────────────────────────────────

export default function AdminPerformanceDashboard() {
  const [data, setData] = useState<PerformanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/performance", { cache: "no-store" });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error ?? "Failed to load performance data");
      }
      setData(await res.json());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load performance data",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const slowShare =
    data && data.overview.totalRequests > 0
      ? Math.round(
          (data.overview.slowRequests / data.overview.totalRequests) * 100,
        )
      : 0;

  return (
    <main className="min-h-screen bg-[#07070a] text-white">
      {/* Ambient background glows */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-48 top-24 h-96 w-96 rounded-full bg-violet-700/15 blur-[120px]" />
        <div className="absolute -right-48 top-1/3 h-96 w-96 rounded-full bg-cyan-700/10 blur-[130px]" />
        <div className="absolute bottom-0 left-1/3 h-80 w-80 rounded-full bg-emerald-700/8 blur-[140px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-5 py-8 md:px-8">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link
              href="/admin/analytics"
              className="mb-5 inline-flex items-center gap-2 text-sm text-zinc-400 transition hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Admin Analytics
            </Link>

            <div className="flex items-center gap-3">
              <span className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3 text-cyan-300">
                <Activity className="h-6 w-6" />
              </span>
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.25em] text-cyan-300">
                  Admin Intelligence
                </p>
                <h1 className="mt-1 text-3xl font-semibold tracking-tight md:text-4xl">
                  Performance Telemetry
                </h1>
              </div>
            </div>

            <p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-400">
              Real-time backend response latency, Edge-region request
              distribution, and Prisma database query metrics — no external SaaS
              required.
            </p>
          </div>

          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-2 self-start rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-zinc-300 transition hover:bg-white/[0.08] disabled:opacity-50 lg:self-auto"
            aria-label="Refresh performance telemetry"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </header>

        {error && (
          <div className="mb-6 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {/* ── KPI Cards ──────────────────────────────────────────────────── */}
        <section
          aria-label="Key performance indicators"
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        >
          {loading ? (
            <>
              <Skeleton className="h-36" />
              <Skeleton className="h-36" />
              <Skeleton className="h-36" />
              <Skeleton className="h-36" />
            </>
          ) : (
            <>
              <MetricCard
                label="Total requests"
                value={data?.overview.totalRequests ?? 0}
                detail="tracked in current window"
                icon={Zap}
                accent="cyan"
              />
              <MetricCard
                label="Avg latency"
                value={formatMs(data?.overview.avgMs ?? 0)}
                detail="mean across all routes"
                icon={Clock}
                accent="violet"
              />
              <MetricCard
                label="p95 latency"
                value={formatMs(data?.overview.p95Ms ?? 0)}
                detail="95th percentile response time"
                icon={Activity}
                accent={(data?.overview.p95Ms ?? 0) > 800 ? "red" : "emerald"}
              />
              <MetricCard
                label="Slow requests"
                value={`${slowShare}%`}
                detail={`>${data?.overview.slowThresholdMs ?? 800} ms threshold`}
                icon={ServerCrash}
                accent={slowShare > 10 ? "red" : "amber"}
              />
            </>
          )}
        </section>

        {/* ── Cold-Start / Latency Trend Chart ───────────────────────────── */}
        <section
          aria-label="Latency trend over last 24 hours"
          className="mt-8 rounded-3xl border border-white/10 bg-white/[0.04] p-6"
        >
          <SectionHeader
            title="Cold-Start & Response Latency"
            description="Hourly average and p95 response times — spikes reveal cold-start events on serverless Edge functions"
          />

          {loading ? (
            <Skeleton className="h-64 w-full" />
          ) : data && data.latencyTrend.some((b) => b.requestCount > 0) ? (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart
                data={data.latencyTrend}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="gradAvg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.3} />
                    <stop
                      offset="100%"
                      stopColor="#22d3ee"
                      stopOpacity={0.02}
                    />
                  </linearGradient>
                  <linearGradient id="gradP95" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.25} />
                    <stop
                      offset="100%"
                      stopColor="#a78bfa"
                      stopOpacity={0.02}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.06)"
                  vertical={false}
                />
                <XAxis
                  dataKey="hour"
                  tickFormatter={formatHour}
                  tick={{ fill: "#71717a", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tickFormatter={(v) => `${v} ms`}
                  tick={{ fill: "#71717a", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={64}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value: any, name: any) => [
                    formatMs(Number(value) || 0),
                    name === "avgMs" ? "Avg" : "p95",
                  ]}
                  labelFormatter={(label) =>
                    `Hour: ${formatHour(String(label))}`
                  }
                />
                <Area
                  type="monotone"
                  dataKey="avgMs"
                  stroke="#22d3ee"
                  strokeWidth={2}
                  fill="url(#gradAvg)"
                  dot={false}
                  name="avgMs"
                />
                <Area
                  type="monotone"
                  dataKey="p95Ms"
                  stroke="#a78bfa"
                  strokeWidth={2}
                  fill="url(#gradP95)"
                  dot={false}
                  name="p95Ms"
                  strokeDasharray="4 2"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="No latency samples yet — requests will appear here as traffic flows in." />
          )}

          {/* Legend */}
          {!loading && data && (
            <div className="mt-4 flex items-center gap-6 text-xs text-zinc-500">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-6 bg-cyan-400" /> Avg
                latency
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-0.5 w-6"
                  style={{
                    background:
                      "repeating-linear-gradient(to right,#a78bfa 0,#a78bfa 4px,transparent 4px,transparent 6px)",
                  }}
                />{" "}
                p95 latency
              </span>
            </div>
          )}
        </section>

        {/* ── Region Breakdown ────────────────────────────────────────────── */}
        <section
          aria-label="Request distribution by region"
          className="mt-6 grid gap-6 xl:grid-cols-5"
        >
          {/* Bar chart */}
          <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 xl:col-span-3">
            <SectionHeader
              title="Edge Region Distribution"
              description="Where requests are landing in the Edge server network (country / region code)"
            />
            {loading ? (
              <Skeleton className="h-64 w-full" />
            ) : data && data.regionBreakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={data.regionBreakdown.slice(0, 12)}
                  margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
                  layout="vertical"
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(255,255,255,0.06)"
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    tick={{ fill: "#71717a", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="region"
                    tick={{ fill: "#a1a1aa", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={56}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value: any) => [`${value} req`, "Requests"]}
                  />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]} maxBarSize={18}>
                    {data.regionBreakdown.slice(0, 12).map((entry, i) => (
                      <Cell
                        key={entry.region}
                        fill={
                          i === 0
                            ? "#22d3ee"
                            : i === 1
                              ? "#a78bfa"
                              : i === 2
                                ? "#34d399"
                                : "#3f3f46"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message="No region data yet — deploy to Vercel Edge to see geographic distribution." />
            )}
          </article>

          {/* Region table */}
          <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 xl:col-span-2">
            <SectionHeader
              title="Top Regions"
              description="Request count and avg latency per origin"
            />
            {loading ? (
              <div className="space-y-3">
                {[...Array(6)].map((_, i) => (
                  <Skeleton key={i} className="h-8" />
                ))}
              </div>
            ) : data && data.regionBreakdown.length > 0 ? (
              <div className="space-y-2">
                {data.regionBreakdown.slice(0, 8).map((item, i) => (
                  <div
                    key={item.region}
                    className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5"
                  >
                    <div className="flex items-center gap-2.5">
                      <Globe className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
                      <span className="text-sm font-medium text-zinc-200">
                        {item.region === "unknown"
                          ? "Local / Unknown"
                          : item.region.toUpperCase()}
                      </span>
                      {i === 0 && (
                        <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium text-cyan-400">
                          Top
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="text-zinc-400">
                        {item.count.toLocaleString()} req
                      </span>
                      <span
                        className="font-mono font-medium"
                        style={{ color: latencyColor(item.avgMs) }}
                      >
                        {formatMs(item.avgMs)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message="No region data yet." />
            )}
          </article>
        </section>

        {/* ── Prisma DB Metrics ───────────────────────────────────────────── */}
        <section
          aria-label="Prisma database query metrics"
          className="mt-6 grid gap-6 xl:grid-cols-5"
        >
          {/* Per-model bar chart */}
          <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 xl:col-span-3">
            <SectionHeader
              title="Prisma DB Query Latency"
              description="Avg and p95 execution time per Postgres model (sourced from Prisma middleware hook)"
            />

            {loading ? (
              <Skeleton className="h-64 w-full" />
            ) : data?.routeBreakdown && data.routeBreakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={data.routeBreakdown.slice(0, 10)}
                  margin={{ top: 8, right: 8, left: 0, bottom: 60 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(255,255,255,0.06)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="route"
                    tick={{
                      fill: "#71717a",
                      fontSize: 10,
                      angle: -35,
                      textAnchor: "end",
                    }}
                    interval={0}
                    axisLine={false}
                    tickLine={false}
                    height={60}
                  />
                  <YAxis
                    tickFormatter={(v) => `${v} ms`}
                    tick={{ fill: "#71717a", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={64}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value: any, name: any) => [
                      formatMs(Number(value) || 0),
                      name === "avgMs" ? "Avg" : "p95",
                    ]}
                  />
                  <Bar
                    dataKey="avgMs"
                    name="avgMs"
                    fill="#22d3ee"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                  />
                  <Bar
                    dataKey="p95Ms"
                    name="p95Ms"
                    fill="#a78bfa"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message="No route data recorded yet — latency samples appear as the API handles requests." />
            )}
          </article>

          {/* Route detail table */}
          <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 xl:col-span-2">
            <SectionHeader
              title="Slowest Routes"
              description="Sorted by p95 — ideal candidates for caching or query optimisation"
            />
            {loading ? (
              <div className="space-y-3">
                {[...Array(6)].map((_, i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            ) : data && data.routeBreakdown.length > 0 ? (
              <div
                className="space-y-2 overflow-y-auto"
                style={{ maxHeight: 280 }}
              >
                {data.routeBreakdown.map((item) => (
                  <div
                    key={item.route}
                    className="rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5"
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span className="max-w-[160px] truncate font-mono text-xs text-zinc-300">
                        {item.route}
                      </span>
                      <span className="text-xs text-zinc-600">
                        {item.requestCount} req
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="text-zinc-500">
                        avg{" "}
                        <span
                          className="font-medium"
                          style={{ color: latencyColor(item.avgMs) }}
                        >
                          {formatMs(item.avgMs)}
                        </span>
                      </span>
                      <span className="text-zinc-500">
                        p95{" "}
                        <span
                          className="font-medium"
                          style={{ color: latencyColor(item.p95Ms) }}
                        >
                          {formatMs(item.p95Ms)}
                        </span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message="No route data yet." />
            )}
          </article>
        </section>

        {/* ── Recent Request Log ──────────────────────────────────────────── */}
        <section
          aria-label="Recent request log"
          className="mt-6 rounded-3xl border border-white/10 bg-white/[0.04] p-6"
        >
          <div className="mb-4 flex items-center gap-3">
            <Database className="h-5 w-5 text-violet-400" />
            <h2 className="text-lg font-semibold">Recent Request Log</h2>
          </div>

          {loading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : data && data.recentSamples.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-zinc-600">
                    <th className="px-3 py-3 font-medium">Route</th>
                    <th className="px-3 py-3 font-medium">Duration</th>
                    <th className="px-3 py-3 font-medium">Region</th>
                    <th className="px-3 py-3 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentSamples.slice(0, 20).map((sample, i) => (
                    <tr
                      key={`${sample.timestamp}-${i}`}
                      className="border-b border-white/5 last:border-0"
                    >
                      <td className="px-3 py-3 font-mono text-xs text-zinc-300">
                        {sample.route}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className="inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-medium"
                          style={{
                            color: latencyColor(sample.durationMs),
                            backgroundColor: `${latencyColor(sample.durationMs)}18`,
                          }}
                        >
                          {formatMs(sample.durationMs)}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs text-zinc-400">
                        {sample.region === "unknown"
                          ? "local"
                          : sample.region.toUpperCase()}
                      </td>
                      <td className="px-3 py-3 text-xs text-zinc-600">
                        {new Date(sample.timestamp).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState message="No requests recorded yet — requests appear here as traffic flows through the platform." />
          )}
        </section>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <footer className="mt-6 flex flex-col gap-2 text-xs text-zinc-600 sm:flex-row sm:items-center sm:justify-between">
          <span>
            Admin-only · First-party performance signals · No external SaaS
          </span>
          <span>
            {data?.generatedAt
              ? `Updated ${new Date(data.generatedAt).toLocaleString()}`
              : loading
                ? "Loading telemetry…"
                : "No telemetry loaded"}
          </span>
        </footer>
      </div>
    </main>
  );
}
