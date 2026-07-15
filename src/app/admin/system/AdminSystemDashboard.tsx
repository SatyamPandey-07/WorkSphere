"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  Database,
  Gauge,
  MousePointerClick,
  RefreshCw,
  Search,
  Star,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type RangeKey = "7d" | "30d" | "90d";

type SystemMetrics = {
  range: RangeKey;
  generatedAt: string;
  usageTrend: Array<{
    date: string;
    searches: number;
    venueClicks: number;
    reviews: number;
  }>;
  overview: {
    totalSearches: number;
    totalVenueClicks: number;
    totalReviews: number;
    agentAvgMs: number;
    agentP95Ms: number;
  };
  agentLatencyTrend: Array<{
    date: string;
    avgMs: number;
    p95Ms: number;
    runs: number;
  }>;
  agentBreakdown: Array<{
    agent: string;
    avgMs: number;
    p95Ms: number;
    runs: number;
  }>;
  dbLatency: {
    totalQueryCount: number;
    slowQueryCount: number;
    slowQueryThresholdMs: number;
    avgMs: number;
    p95Ms: number;
    byModel: Array<{
      model: string;
      avgMs: number;
      p95Ms: number;
      sampleCount: number;
    }>;
  };
};

const ranges: Array<{ key: RangeKey; label: string }> = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
];

function formatDuration(value: number) {
  if (!value) return "—";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

function compactDate(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/10 backdrop-blur-xl">
      <div className="mb-5 flex items-center justify-between">
        <span className="text-sm text-zinc-400">{label}</span>
        <span className="rounded-2xl bg-violet-500/10 p-2.5 text-violet-300">
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <p className="text-3xl font-semibold tracking-tight text-white">{value}</p>
      <p className="mt-2 text-xs text-zinc-500">{detail}</p>
    </article>
  );
}

const tooltipStyle = {
  background: "#111114",
  border: "1px solid #27272a",
  borderRadius: 16,
};

export default function AdminSystemDashboard() {
  const [range, setRange] = useState<RangeKey>("30d");
  const [data, setData] = useState<SystemMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadMetrics(selectedRange: RangeKey) {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/admin/system?range=${selectedRange}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Unable to load system metrics");
      }

      setData(await response.json());
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load system metrics",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMetrics(range);
  }, [range]);

  const slowQueryShare = useMemo(() => {
    if (!data || data.dbLatency.totalQueryCount === 0) return 0;
    return Math.round(
      (data.dbLatency.slowQueryCount / data.dbLatency.totalQueryCount) * 100,
    );
  }, [data]);

  return (
    <main className="min-h-screen bg-[#07070a] text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-48 top-24 h-96 w-96 rounded-full bg-violet-700/15 blur-[120px]" />
        <div className="absolute -right-48 top-1/3 h-96 w-96 rounded-full bg-cyan-700/10 blur-[130px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-5 py-8 md:px-8">
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
              <span className="rounded-2xl border border-violet-400/20 bg-violet-400/10 p-3 text-violet-300">
                <Gauge className="h-6 w-6" />
              </span>
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.25em] text-violet-300">
                  Admin Intelligence
                </p>
                <h1 className="mt-1 text-3xl font-semibold tracking-tight md:text-4xl">
                  System Health
                </h1>
              </div>
            </div>

            <p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-400">
              Platform usage volume alongside AI agent execution time and
              database query latency, so you can spot load or performance
              regressions early.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-2xl border border-white/10 bg-white/[0.04] p-1">
              {ranges.map((item) => (
                <button
                  key={item.key}
                  onClick={() => setRange(item.key)}
                  className={`rounded-xl px-4 py-2 text-sm transition ${
                    range === item.key
                      ? "bg-white text-black"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <button
              onClick={() => loadMetrics(range)}
              disabled={loading}
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-zinc-300 transition hover:bg-white/[0.08] disabled:opacity-50"
              aria-label="Refresh system metrics"
            >
              <RefreshCw className={`h-5 w-5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </header>

        {error && (
          <div className="mb-6 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            label="Search queries"
            value={data?.overview.totalSearches ?? "—"}
            detail="in selected window"
            icon={Search}
          />
          <MetricCard
            label="Venue clicks"
            value={data?.overview.totalVenueClicks ?? "—"}
            detail="venue detail views"
            icon={MousePointerClick}
          />
          <MetricCard
            label="Reviews"
            value={data?.overview.totalReviews ?? "—"}
            detail="submitted in window"
            icon={Star}
          />
          <MetricCard
            label="Agent latency"
            value={formatDuration(data?.overview.agentAvgMs ?? 0)}
            detail={`p95 ${formatDuration(data?.overview.agentP95Ms ?? 0)}`}
            icon={Activity}
          />
          <MetricCard
            label="DB query latency"
            value={formatDuration(data?.dbLatency.avgMs ?? 0)}
            detail={`${slowQueryShare}% queries over ${
              data?.dbLatency.slowQueryThresholdMs ?? 200
            }ms`}
            icon={Database}
          />
        </section>

        <section className="mt-6 rounded-3xl border border-white/10 bg-white/[0.04] p-5">
          <div className="mb-6">
            <h2 className="text-lg font-semibold">Usage volume</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Search queries, venue clicks, and reviews per day
            </p>
          </div>

          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data?.usageTrend ?? []}>
                <defs>
                  <linearGradient id="searchFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="clicksFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="reviewsFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#fbbf24" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis
                  dataKey="date"
                  tickFormatter={compactDate}
                  stroke="#71717a"
                  fontSize={12}
                  minTickGap={24}
                />
                <YAxis allowDecimals={false} stroke="#71717a" fontSize={12} />
                <Tooltip
                  labelFormatter={(value: any) => compactDate(String(value))}
                  contentStyle={tooltipStyle}
                />
                <Area
                  type="monotone"
                  dataKey="searches"
                  stroke="#a78bfa"
                  strokeWidth={2}
                  fill="url(#searchFill)"
                />
                <Area
                  type="monotone"
                  dataKey="venueClicks"
                  stroke="#22d3ee"
                  strokeWidth={2}
                  fill="url(#clicksFill)"
                />
                <Area
                  type="monotone"
                  dataKey="reviews"
                  stroke="#fbbf24"
                  strokeWidth={2}
                  fill="url(#reviewsFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-5">
          <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 xl:col-span-3">
            <div className="mb-6">
              <h2 className="text-lg font-semibold">AI agent execution time</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Average and p95 agent latency per day
              </p>
            </div>

            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data?.agentLatencyTrend ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={compactDate}
                    stroke="#71717a"
                    fontSize={12}
                    minTickGap={24}
                  />
                  <YAxis stroke="#71717a" fontSize={12} />
                  <Tooltip
                    labelFormatter={(value: any) => compactDate(String(value))}
                    contentStyle={tooltipStyle}
                  />
                  <Line
                    type="monotone"
                    dataKey="avgMs"
                    name="avg ms"
                    stroke="#a78bfa"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="p95Ms"
                    name="p95 ms"
                    stroke="#f472b6"
                    strokeWidth={2}
                    strokeDasharray="4 4"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </article>

          <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 xl:col-span-2">
            <div className="mb-6">
              <h2 className="text-lg font-semibold">DB latency by model</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Rolling sample average per Prisma model, this instance
              </p>
            </div>

            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data?.dbLatency.byModel.slice(0, 8) ?? []}
                  layout="vertical"
                  margin={{ left: 12 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis type="number" stroke="#71717a" fontSize={12} />
                  <YAxis
                    type="category"
                    dataKey="model"
                    stroke="#71717a"
                    fontSize={12}
                    width={90}
                  />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="avgMs" name="avg ms" fill="#22d3ee" radius={6} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </article>
        </section>

        {data && data.agentBreakdown.length > 0 && (
          <section className="mt-6 rounded-3xl border border-white/10 bg-white/[0.04] p-5">
            <div className="mb-4">
              <h2 className="text-lg font-semibold">Agent breakdown</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Runs, average latency, and p95 per agent in the selected window
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-zinc-500">
                    <th className="pb-3 pr-4 font-medium">Agent</th>
                    <th className="pb-3 pr-4 font-medium">Runs</th>
                    <th className="pb-3 pr-4 font-medium">Avg</th>
                    <th className="pb-3 font-medium">p95</th>
                  </tr>
                </thead>
                <tbody>
                  {data.agentBreakdown.map((row) => (
                    <tr key={row.agent} className="border-t border-white/5">
                      <td className="py-3 pr-4 text-zinc-200">{row.agent}</td>
                      <td className="py-3 pr-4 text-zinc-400">{row.runs}</td>
                      <td className="py-3 pr-4 text-zinc-400">
                        {formatDuration(row.avgMs)}
                      </td>
                      <td className="py-3 text-zinc-400">
                        {formatDuration(row.p95Ms)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <p className="mt-6 text-xs text-zinc-600">
          DB latency stats are collected in-memory per server instance and
          reset on restart — they reflect current health, not a durable audit
          log. Last refreshed{" "}
          {data ? new Date(data.generatedAt).toLocaleTimeString() : "—"}.
        </p>
      </div>
    </main>
  );
}