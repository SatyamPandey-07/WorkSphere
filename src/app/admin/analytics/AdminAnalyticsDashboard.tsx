"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Bot,
  CalendarDays,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type RangeKey = "7d" | "30d" | "90d";

type AnalyticsData = {
  range: RangeKey;
  generatedAt: string;
  overview: {
    activeUsers: number;
    totalUsers: number;
    searches: number;
    bookings: number;
    averageResolutionMs: number;
    agentSuccessRate: number;
  };
  searchTerms: Array<{ term: string; count: number }>;
  amenities: Array<{ amenity: string; count: number }>;
  venueLeaderboard: Array<{
    id: string;
    name: string;
    category: string;
    views: number;
    bookings: number;
    rating: number;
    score: number;
  }>;
  bookingTrend: Array<{ date: string; bookings: number }>;
  ratingTrend: Array<{ date: string; rating: number | null }>;
};

const ranges: Array<{ key: RangeKey; label: string }> = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
];

function formatDuration(value: number) {
  if (!value) return "—";
  if (value < 1000) return `${value} ms`;
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

export default function AdminAnalyticsDashboard() {
  const [range, setRange] = useState<RangeKey>("30d");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadAnalytics(selectedRange: RangeKey) {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/admin/analytics?range=${selectedRange}`,
        { cache: "no-store" },
      );

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Unable to load analytics");
      }

      setData(await response.json());
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load analytics",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAnalytics(range);
  }, [range]);

  const maxTermCount = useMemo(
    () => Math.max(...(data?.searchTerms.map((item) => item.count) ?? [1]), 1),
    [data],
  );

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
              href="/"
              className="mb-5 inline-flex items-center gap-2 text-sm text-zinc-400 transition hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to WorkSphere
            </Link>

            <div className="flex items-center gap-3">
              <span className="rounded-2xl border border-violet-400/20 bg-violet-400/10 p-3 text-violet-300">
                <BarChart3 className="h-6 w-6" />
              </span>
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.25em] text-violet-300">
                  Admin Intelligence
                </p>
                <h1 className="mt-1 text-3xl font-semibold tracking-tight md:text-4xl">
                  Platform Analytics
                </h1>
              </div>
            </div>

            <p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-400">
              Private operational view of discovery demand, venue performance,
              user activity, and agent responsiveness.
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
              onClick={() => loadAnalytics(range)}
              disabled={loading}
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-zinc-300 transition hover:bg-white/[0.08] disabled:opacity-50"
              aria-label="Refresh analytics"
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

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
          <MetricCard
            label="Active users"
            value={data?.overview.activeUsers ?? "—"}
            detail={`${data?.overview.totalUsers ?? 0} total accounts`}
            icon={Users}
          />
          <MetricCard
            label="Searches"
            value={data?.overview.searches ?? "—"}
            detail="queries in selected window"
            icon={Search}
          />
          <MetricCard
            label="Bookings"
            value={data?.overview.bookings ?? "—"}
            detail="excluding cancellations"
            icon={CalendarDays}
          />
          <MetricCard
            label="Agent latency"
            value={formatDuration(data?.overview.averageResolutionMs ?? 0)}
            detail="average resolution time"
            icon={Bot}
          />
          <MetricCard
            label="Agent success"
            value={`${data?.overview.agentSuccessRate ?? 0}%`}
            detail="successful agent runs"
            icon={Sparkles}
          />
          <MetricCard
            label="Telemetry"
            value={data ? "Live" : "—"}
            detail="private first-party signals"
            icon={Activity}
          />
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-5">
          <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 xl:col-span-3">
            <div className="mb-6">
              <h2 className="text-lg font-semibold">Booking trend</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Daily workspace bookings across the platform
              </p>
            </div>

            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data?.bookingTrend ?? []}>
                  <defs>
                    <linearGradient id="bookingFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.45} />
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
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
                    labelFormatter={(value) => compactDate(String(value))}
                    contentStyle={{
                      background: "#111114",
                      border: "1px solid #27272a",
                      borderRadius: 16,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="bookings"
                    stroke="#a78bfa"
                    strokeWidth={2}
                    fill="url(#bookingFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </article>

          <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 xl:col-span-2">
            <div className="mb-6">
              <h2 className="text-lg font-semibold">Rating trend</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Average WiFi-quality rating submitted each day
              </p>
            </div>

            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data?.ratingTrend ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={compactDate}
                    stroke="#71717a"
                    fontSize={12}
                    minTickGap={24}
                  />
                  <YAxis domain={[0, 5]} stroke="#71717a" fontSize={12} />
                  <Tooltip
                    labelFormatter={(value) => compactDate(String(value))}
                    contentStyle={{
                      background: "#111114",
                      border: "1px solid #27272a",
                      borderRadius: 16,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="rating"
                    stroke="#22d3ee"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </article>
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-2">
          <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
            <div className="mb-6">
              <h2 className="text-lg font-semibold">Search term cloud</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Most frequent meaningful terms in natural-language searches
              </p>
            </div>

            <div className="flex min-h-52 flex-wrap content-start gap-2">
              {(data?.searchTerms ?? []).map((item) => {
                const weight = item.count / maxTermCount;
                const size = 12 + Math.round(weight * 15);

                return (
                  <span
                    key={item.term}
                    className="rounded-full border border-violet-400/15 bg-violet-400/[0.07] px-3 py-1.5 text-violet-100"
                    style={{ fontSize: size }}
                    title={`${item.count} searches`}
                  >
                    {item.term}
                    <sup className="ml-1 text-[9px] text-violet-300">
                      {item.count}
                    </sup>
                  </span>
                );
              })}

              {data?.searchTerms.length === 0 && (
                <p className="text-sm text-zinc-500">
                  Search telemetry will appear here as users run queries.
                </p>
              )}
            </div>
          </article>

          <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
            <div className="mb-6">
              <h2 className="text-lg font-semibold">Requested amenities</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Most common filters and workspace requirements
              </p>
            </div>

            <div className="space-y-4">
              {(data?.amenities ?? []).map((item, index) => {
                const topCount = data?.amenities[0]?.count || 1;
                const width = Math.max((item.count / topCount) * 100, 5);

                return (
                  <div key={item.amenity}>
                    <div className="mb-1.5 flex items-center justify-between text-sm">
                      <span className="capitalize text-zinc-300">
                        {item.amenity.replaceAll("_", " ")}
                      </span>
                      <span className="text-zinc-500">{item.count}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/5">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400"
                        style={{ width: `${width}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </article>
        </section>

        <section className="mt-6 rounded-3xl border border-white/10 bg-white/[0.04] p-5">
          <div className="mb-6">
            <h2 className="text-lg font-semibold">Venue popularity leaderboard</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Composite ranking based on views, non-cancelled bookings, and ratings
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-zinc-500">
                  <th className="px-3 py-3 font-medium">Rank</th>
                  <th className="px-3 py-3 font-medium">Venue</th>
                  <th className="px-3 py-3 font-medium">Views</th>
                  <th className="px-3 py-3 font-medium">Bookings</th>
                  <th className="px-3 py-3 font-medium">Rating</th>
                  <th className="px-3 py-3 font-medium">Score</th>
                </tr>
              </thead>
              <tbody>
                {(data?.venueLeaderboard ?? []).map((venue, index) => (
                  <tr
                    key={venue.id}
                    className="border-b border-white/5 text-sm last:border-0"
                  >
                    <td className="px-3 py-4 text-zinc-500">
                      {String(index + 1).padStart(2, "0")}
                    </td>
                    <td className="px-3 py-4">
                      <p className="font-medium text-white">{venue.name}</p>
                      <p className="mt-1 text-xs capitalize text-zinc-500">
                        {venue.category}
                      </p>
                    </td>
                    <td className="px-3 py-4 text-zinc-300">{venue.views}</td>
                    <td className="px-3 py-4 text-zinc-300">{venue.bookings}</td>
                    <td className="px-3 py-4">
                      <span className="inline-flex items-center gap-1 text-amber-300">
                        <Star className="h-4 w-4 fill-current" />
                        {venue.rating.toFixed(1)}
                      </span>
                    </td>
                    <td className="px-3 py-4 font-medium text-violet-300">
                      {venue.score}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="mt-6 flex flex-col gap-2 text-xs text-zinc-600 sm:flex-row sm:items-center sm:justify-between">
          <span>Admin-only · First-party analytics · No third-party tracking</span>
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
