"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  Mail,
  MailCheck,
  MailX,
  RefreshCw,
  Search,
  Send,
  XCircle,
  Loader2,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from "recharts";

type RangeKey = "7d" | "30d" | "90d";

type EmailMetrics = {
  range: RangeKey;
  generatedAt: string;
  overview: {
    totalSent: number;
    totalFailed: number;
    totalPending: number;
    bounceRate: number;
    sentToday: number;
    failedToday: number;
  };
  trend: Array<{ date: string; sent: number; failed: number }>;
  byType: Array<{ type: string; sent: number; failed: number; total: number }>;
  logs: Array<{
    id: string;
    type: string;
    recipient: string;
    subject: string;
    status: string;
    error: string | null;
    createdAt: string;
  }>;
  logsTotal: number;
};

const ranges: Array<{ key: RangeKey; label: string }> = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
];

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
  accent,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: string;
}) {
  return (
    <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/10 backdrop-blur-xl">
      <div className="mb-5 flex items-center justify-between">
        <span className="text-sm text-zinc-400">{label}</span>
        <span
          className={`rounded-2xl p-2.5 ${
            accent === "red"
              ? "bg-red-500/10 text-red-300"
              : accent === "amber"
                ? "bg-amber-500/10 text-amber-300"
                : accent === "emerald"
                  ? "bg-emerald-500/10 text-emerald-300"
                  : "bg-violet-500/10 text-violet-300"
          }`}
        >
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <p className="text-3xl font-semibold tracking-tight text-white">{value}</p>
      <p className="mt-2 text-xs text-zinc-500">{detail}</p>
    </article>
  );
}

const STATUS_COLORS: Record<string, string> = {
  SENT: "#22c55e",
  FAILED: "#ef4444",
  PENDING: "#f59e0b",
};

const STATUS_BADGE: Record<string, string> = {
  SENT: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
  FAILED: "bg-red-500/10 text-red-300 border-red-500/20",
  PENDING: "bg-amber-500/10 text-amber-300 border-amber-500/20",
};

const TYPE_LABELS: Record<string, string> = {
  VERIFICATION_CODE: "Verification Code",
  OTP: "OTP",
  PASSWORD_RESET: "Password Reset",
  GUEST_INVITE: "Guest Invite",
  NEWSLETTER: "Newsletter",
  COLLECTION_INVITE: "Collection Invite",
  TEST: "Test",
};

export default function AdminEmailDashboard() {
  const [range, setRange] = useState<RangeKey>("30d");
  const [data, setData] = useState<EmailMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // Test email state
  const [testEmail, setTestEmail] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  async function loadMetrics(selectedRange: RangeKey, searchQuery?: string, pageNum = 1) {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({ range: selectedRange, page: String(pageNum), pageSize: String(pageSize) });
      if (searchQuery) params.set("search", searchQuery);

      const response = await fetch(`/api/admin/emails?${params}`, { cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Unable to load email metrics");
      }
      setData(await response.json());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load email metrics");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMetrics(range, search, page);
  }, [range, page]);

  function handleSearch() {
    setPage(1);
    setSearch(searchInput);
    loadMetrics(range, searchInput, 1);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleSearch();
  }

  async function handleSendTest() {
    if (!testEmail || !testEmail.includes("@")) return;
    setSendingTest(true);
    setTestResult(null);

    try {
      const response = await fetch("/api/admin/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sendTest", recipient: testEmail }),
      });
      const result = await response.json();
      setTestResult(result);
      if (result.success) {
        setTestEmail("");
        loadMetrics(range, search, page);
      }
    } catch (err) {
      setTestResult({ success: false, message: "Network error" });
    } finally {
      setSendingTest(false);
    }
  }

  const totalPages = data ? Math.ceil(data.logsTotal / pageSize) : 0;

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
              Back to Admin Dashboard
            </Link>

            <div className="flex items-center gap-3">
              <span className="rounded-2xl border border-violet-400/20 bg-violet-400/10 p-3 text-violet-300">
                <Mail className="h-6 w-6" />
              </span>
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.25em] text-violet-300">
                  Admin Intelligence
                </p>
                <h1 className="mt-1 text-3xl font-semibold tracking-tight md:text-4xl">
                  Email Dashboard
                </h1>
              </div>
            </div>

            <p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-400">
              Monitor SMTP delivery, verification email queues, sign-up OTP failures, and send test emails.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-2xl border border-white/10 bg-white/[0.04] p-1">
              {ranges.map((item) => (
                <button
                  key={item.key}
                  onClick={() => { setRange(item.key); setPage(1); }}
                  className={`rounded-xl px-4 py-2 text-sm transition ${
                    range === item.key ? "bg-white text-black" : "text-zinc-400 hover:text-white"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <button
              onClick={() => loadMetrics(range, search, page)}
              disabled={loading}
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-zinc-300 transition hover:bg-white/[0.08] disabled:opacity-50"
              aria-label="Refresh"
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

        {/* Delivery Metrics */}
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
          <MetricCard
            label="Sent"
            value={data?.overview.totalSent ?? "—"}
            detail={`${data?.overview.sentToday ?? 0} today`}
            icon={MailCheck}
            accent="emerald"
          />
          <MetricCard
            label="Failed"
            value={data?.overview.totalFailed ?? "—"}
            detail={`${data?.overview.failedToday ?? 0} today`}
            icon={MailX}
            accent="red"
          />
          <MetricCard
            label="Pending"
            value={data?.overview.totalPending ?? "—"}
            detail="awaiting delivery"
            icon={Loader2}
            accent="amber"
          />
          <MetricCard
            label="Bounce rate"
            value={data ? `${data.overview.bounceRate}%` : "—"}
            detail="of all emails in window"
            icon={XCircle}
            accent="red"
          />
          <MetricCard
            label="Deliverability"
            value={data ? `${(100 - data.overview.bounceRate).toFixed(1)}%` : "—"}
            detail="success rate"
            icon={CheckCircle2}
            accent="emerald"
          />
          <MetricCard
            label="Total volume"
            value={data ? data.overview.totalSent + data.overview.totalFailed + data.overview.totalPending : "—"}
            detail="emails in selected window"
            icon={BarChart3}
          />
        </section>

        {/* Trend Chart + Type Breakdown */}
        <section className="mt-6 grid gap-6 xl:grid-cols-5">
          <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 xl:col-span-3">
            <div className="mb-6">
              <h2 className="text-lg font-semibold">Delivery trend</h2>
              <p className="mt-1 text-sm text-zinc-500">Sent and failed emails per day</p>
            </div>

            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data?.trend ?? []}>
                  <defs>
                    <linearGradient id="sentFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22c55e" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="failedFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
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
                    contentStyle={{ background: "#111114", border: "1px solid #27272a", borderRadius: 16 }}
                  />
                  <Area type="monotone" dataKey="sent" stroke="#22c55e" strokeWidth={2} fill="url(#sentFill)" />
                  <Area type="monotone" dataKey="failed" stroke="#ef4444" strokeWidth={2} fill="url(#failedFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </article>

          <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 xl:col-span-2">
            <div className="mb-6">
              <h2 className="text-lg font-semibold">By type</h2>
              <p className="mt-1 text-sm text-zinc-500">Email volume breakdown by purpose</p>
            </div>

            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <RechartsBarChart
                  data={data?.byType ?? []}
                  layout="vertical"
                  margin={{ left: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis type="number" stroke="#71717a" fontSize={12} />
                  <YAxis
                    type="category"
                    dataKey="type"
                    stroke="#71717a"
                    fontSize={11}
                    width={90}
                    tickFormatter={(value: string) => TYPE_LABELS[value] ?? value}
                  />
                  <Tooltip
                    contentStyle={{ background: "#111114", border: "1px solid #27272a", borderRadius: 16 }}
                    formatter={(value, name) => [value ?? 0, name === "sent" ? "Sent" : "Failed"]}
                  />
                  <Bar dataKey="sent" name="sent" stackId="a" fill="#22c55e" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="failed" name="failed" stackId="a" fill="#ef4444" radius={[0, 4, 4, 0]} />
                </RechartsBarChart>
              </ResponsiveContainer>
            </div>
          </article>
        </section>

        {/* Test Interface */}
        <section className="mt-6 rounded-3xl border border-white/10 bg-white/[0.04] p-5">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">SMTP Test Interface</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Send a test email to verify SMTP server configuration.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor="test-email" className="mb-1.5 block text-xs text-zinc-400">
                Recipient email
              </label>
              <input
                id="test-email"
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSendTest()}
                placeholder="admin@example.com"
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-white placeholder-zinc-500 outline-none transition focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30"
              />
            </div>
            <button
              onClick={handleSendTest}
              disabled={sendingTest || !testEmail}
              className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-50"
            >
              {sendingTest ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {sendingTest ? "Sending..." : "Send Test"}
            </button>
          </div>

          {testResult && (
            <div
              className={`mt-3 rounded-xl border px-4 py-3 text-sm ${
                testResult.success
                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                  : "border-red-500/20 bg-red-500/10 text-red-200"
              }`}
            >
              {testResult.message}
            </div>
          )}
        </section>

        {/* Logs Table */}
        <section className="mt-6 rounded-3xl border border-white/10 bg-white/[0.04] p-5">
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Email Logs</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Searchable history of all dispatched emails
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Search by email or subject..."
                  className="w-64 rounded-xl border border-white/10 bg-white/[0.04] py-2 pl-10 pr-4 text-sm text-white placeholder-zinc-500 outline-none transition focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30"
                />
              </div>
              <button
                onClick={handleSearch}
                className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-zinc-300 transition hover:bg-white/[0.08]"
              >
                Search
              </button>
            </div>
          </div>

          {loading && data === null ? (
            <div className="flex items-center justify-center py-16 text-zinc-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading logs...
            </div>
          ) : data && data.logs.length === 0 ? (
            <div className="py-16 text-center text-sm text-zinc-500">
              {search ? "No logs match your search." : "No email logs yet. Emails will appear here once sent."}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-zinc-500">
                      <th className="px-3 py-3 font-medium">Status</th>
                      <th className="px-3 py-3 font-medium">Type</th>
                      <th className="px-3 py-3 font-medium">Recipient</th>
                      <th className="px-3 py-3 font-medium">Subject</th>
                      <th className="px-3 py-3 font-medium">Date</th>
                      <th className="px-3 py-3 font-medium">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.logs.map((log) => (
                      <tr key={log.id} className="border-b border-white/5 text-sm last:border-0 hover:bg-white/[0.02]">
                        <td className="px-3 py-4">
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                              STATUS_BADGE[log.status] ?? ""
                            }`}
                          >
                            {log.status === "SENT" && <CheckCircle2 className="mr-1 h-3 w-3" />}
                            {log.status === "FAILED" && <XCircle className="mr-1 h-3 w-3" />}
                            {log.status === "PENDING" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                            {log.status}
                          </span>
                        </td>
                        <td className="px-3 py-4 text-zinc-300">
                          {TYPE_LABELS[log.type] ?? log.type}
                        </td>
                        <td className="px-3 py-4 text-zinc-300">{log.recipient}</td>
                        <td className="max-w-xs truncate px-3 py-4 text-zinc-300">{log.subject}</td>
                        <td className="whitespace-nowrap px-3 py-4 text-zinc-400">
                          {new Date(log.createdAt).toLocaleString()}
                        </td>
                        <td className="max-w-xs truncate px-3 py-4 text-red-300">
                          {log.error ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-4">
                  <p className="text-sm text-zinc-500">
                    Page {page} of {totalPages} ({data?.logsTotal ?? 0} total)
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-zinc-300 transition hover:bg-white/[0.08] disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                      className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-zinc-300 transition hover:bg-white/[0.08] disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        <footer className="mt-6 flex flex-col gap-2 text-xs text-zinc-600 sm:flex-row sm:items-center sm:justify-between">
          <span>Admin-only · Email delivery telemetry</span>
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
