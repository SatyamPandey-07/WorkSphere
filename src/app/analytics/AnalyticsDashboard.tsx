"use client";

import { useEffect, useState } from "react";
import {
    BarChart3,
    Users,
    MapPin,
    MessageSquare,
    Star,
    Heart,
    Activity,
    Zap,
    Search,
    Clock,
    ArrowUpRight,
    ShieldCheck,
    Cpu,
    RefreshCw,
    Box
} from "lucide-react";
import Link from "next/link";

interface AnalyticsData {
    summary: {
        totalEvents: number;
        totalVenues: number;
        totalUsers: number;
        totalRatings: number;
        totalFavorites: number;
        totalConversations: number;
    };
    events: {
        counts: Record<string, number>;
        recent: any[];
    };
    categories: Array<{ name: string; count: number }>;
    agents: Array<{
        agent: string;
        avgDuration: number;
        successRate: number;
        totalCalls: number;
    }>;
    searches: Array<{ query: string; count: number }>;
}

export default function AnalyticsDashboard() {
    const [data, setData] = useState<AnalyticsData | null>(null);
    const [loading, setLoading] = useState(true);

    const fetchStats = async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/analytics");
            const json = await res.json();
            setData(json);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStats();
        const interval = setInterval(fetchStats, 30000); // Auto refresh
        return () => clearInterval(interval);
    }, []);

    if (loading && !data) {
        return (
            <div className="min-h-screen bg-white dark:bg-zinc-950 flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Syncing Neural Data...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 p-6 font-sans">
            <div className="max-w-7xl mx-auto space-y-8">

                {/* Header Section */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div>
                        <div className="flex items-center gap-2 mb-2">
                            <span className="px-2 py-0.5 bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest rounded shadow-lg shadow-blue-500/20">
                                L3 SPRINT
                            </span>
                            <span className="flex items-center gap-1 text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                                <ShieldCheck className="w-3 h-3 text-green-500" />
                                Live Telemetry
                            </span>
                        </div>
                        <h1 className="text-5xl font-black uppercase tracking-tighter leading-none">
                            Intelligence <span className="text-blue-600">Dashboard</span>
                        </h1>
                        <p className="text-zinc-500 font-bold text-xs uppercase tracking-widest mt-2 ml-1">
                            Real-time workspace node performance and user engagement metrics.
                        </p>
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={fetchStats}
                            className="p-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl hover:bg-zinc-100 transition-all active:scale-95 shadow-sm"
                        >
                            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                        <Link
                            href="/ai"
                            className="px-6 py-3 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 !rounded-xl font-black text-xs uppercase tracking-widest shadow-xl flex items-center gap-2 hover:scale-[1.02] transition-all"
                        >
                            Back to Core
                            <ArrowUpRight className="w-4 h-4" />
                        </Link>
                    </div>
                </div>

                {/* Global Stats Grid */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                    {[
                        { label: "Active Nodes", value: data?.summary.totalVenues, icon: MapPin, color: "text-blue-500", bg: "bg-blue-500/10" },
                        { label: "Neural Signals", value: data?.summary.totalEvents, icon: Activity, color: "text-green-500", bg: "bg-green-500/10" },
                        { label: "Active Agents", value: data?.agents.length, icon: Cpu, color: "text-purple-500", bg: "bg-purple-500/10" },
                        { label: "Signal Density", value: data?.summary.totalRatings, icon: Star, color: "text-orange-500", bg: "bg-orange-500/10" },
                        { label: "Node Saves", value: data?.summary.totalFavorites, icon: Heart, color: "text-red-500", bg: "bg-red-500/10" },
                        { label: "Total Minds", value: data?.summary.totalUsers, icon: Users, color: "text-cyan-500", bg: "bg-cyan-500/10" },
                    ].map((stat, i) => (
                        <div key={i} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 rounded-2xl shadow-sm group hover:border-blue-500/30 transition-all">
                            <div className={`p-2 w-max rounded-lg ${stat.bg} mb-4 group-hover:scale-110 transition-transform`}>
                                <stat.icon className={`w-5 h-5 ${stat.color}`} />
                            </div>
                            <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1">{stat.label}</div>
                            <div className="text-2xl font-black leading-none">{stat.value?.toLocaleString()}</div>
                        </div>
                    ))}
                </div>

                {/* Intelligence Breakdown */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                    {/* 1. Agent Performance (High Fidelity Table) */}
                    <div className="lg:col-span-2 space-y-4">
                        <h2 className="text-lg font-black uppercase tracking-tighter flex items-center gap-2">
                            <Zap className="w-5 h-5 text-blue-600" />
                            Agent Core Performance
                        </h2>
                        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl overflow-hidden shadow-sm">
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-zinc-50 dark:bg-zinc-800/50">
                                    <tr>
                                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-400">Agent Class</th>
                                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-400">Avg Latency</th>
                                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-400">Success Rate</th>
                                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-400">Throughput</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                    {data?.agents.map((agent, i) => (
                                        <tr key={i} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-lg bg-blue-600/10 flex items-center justify-center">
                                                        <Cpu className="w-4 h-4 text-blue-600" />
                                                    </div>
                                                    <span className="font-black text-xs uppercase tracking-tight">{agent.agent}</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 font-mono text-xs font-bold text-blue-500">{agent.avgDuration}ms</td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2">
                                                    <div className="flex-1 h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                                                        <div
                                                            className="h-full bg-green-500 rounded-full"
                                                            style={{ width: `${agent.successRate}%` }}
                                                        />
                                                    </div>
                                                    <span className="text-[10px] font-black">{agent.successRate}%</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-zinc-500 font-bold text-xs">{agent.totalCalls} Calls</td>
                                        </tr>
                                    ))}
                                    {(!data?.agents || data.agents.length === 0) && (
                                        <tr>
                                            <td colSpan={4} className="px-6 py-12 text-center text-zinc-400 font-bold uppercase text-[10px] tracking-widest">
                                                Awaiting Agent Telemetry...
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Recent Signal Flow (Visual List) */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
                            {/* Categories */}
                            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6">
                                <h3 className="text-xs font-black uppercase tracking-widest text-zinc-400 mb-6 flex items-center gap-2">
                                    <Box className="w-4 h-4 text-purple-500" />
                                    Node Distribution
                                </h3>
                                <div className="space-y-4">
                                    {data?.categories.map((cat, i) => (
                                        <div key={i} className="space-y-2">
                                            <div className="flex justify-between items-end">
                                                <span className="text-[10px] font-black uppercase tracking-widest">{cat.name.replace('_', ' ')}</span>
                                                <span className="text-xl font-black leading-none">{cat.count}</span>
                                            </div>
                                            <div className="h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-gradient-to-r from-blue-600 to-purple-600"
                                                    style={{ width: `${(cat.count / (data?.summary.totalVenues || 1)) * 100}%` }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Popular Searches */}
                            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6">
                                <h3 className="text-xs font-black uppercase tracking-widest text-zinc-400 mb-6 flex items-center gap-2">
                                    <Search className="w-4 h-4 text-orange-500" />
                                    Neural Intent Patterns
                                </h3>
                                <div className="flex flex-wrap gap-2">
                                    {data?.searches.map((s, i) => (
                                        <div key={i} className="px-3 py-1.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700 rounded-lg flex items-center gap-2">
                                            <span className="text-[10px] font-bold text-zinc-900 dark:text-zinc-50">{s.query}</span>
                                            <span className="text-[9px] font-black text-blue-600 bg-blue-500/10 px-1 rounded">{s.count}</span>
                                        </div>
                                    ))}
                                    {(!data?.searches || data.searches.length === 0) && (
                                        <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest py-4">No patterns recorded</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Side Panel: Signals Activity */}
                    <div className="space-y-6">
                        <div className="bg-zinc-900 text-white rounded-3xl p-6 shadow-2xl relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-8 opacity-10">
                                <Activity className="w-32 h-32" />
                            </div>
                            <h2 className="text-lg font-black uppercase tracking-tighter mb-6 relative">Recent Activity Log</h2>
                            <div className="space-y-6 relative">
                                {data?.events.recent.slice(0, 8).map((event: any, i: number) => (
                                    <div key={i} className="flex gap-4">
                                        <div className="flex flex-col items-center">
                                            <div className="w-2 h-2 rounded-full bg-blue-500" />
                                            <div className="w-px flex-1 bg-zinc-800 mt-2" />
                                        </div>
                                        <div className="pb-4">
                                            <div className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-1">
                                                {new Date(event.timestamp).toLocaleTimeString()}
                                            </div>
                                            <div className="text-xs font-bold uppercase tracking-tight text-white mb-1">
                                                {event.name.replace('_', ' ')}
                                            </div>
                                            <div className="text-[10px] text-zinc-400 font-medium">
                                                {event.properties?.venueName || event.properties?.query || "Neural interaction logged"}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center">
                                    <Zap className="w-5 h-5 text-orange-500" />
                                </div>
                                <div>
                                    <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Signal Density</div>
                                    <div className="text-lg font-black tracking-tight">{Math.round((data?.summary.totalRatings || 0) / (data?.summary.totalVenues || 1) * 100)}% Coverage</div>
                                </div>
                            </div>
                            <p className="text-[10px] font-bold text-zinc-500 leading-relaxed">
                                Neural signal density measures the ratio of verified feedback nodes per workspace entry. High density ensures workspace vibe accuracy.
                            </p>
                        </div>
                    </div>

                </div>

            </div>
        </div>
    );
}
