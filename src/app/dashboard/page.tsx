"use client";

import { useState, useEffect, useCallback } from "react";
import { useUser } from "@clerk/nextjs";
import { 
  getAnalyticsSummary, 
  getAgentMetrics, 
  getPopularSearches,
  clearAnalytics
} from "@/lib/analytics";
import {
  BarChart3,
  TrendingUp,
  Search,
  Clock,
  CheckCircle,
  XCircle,
  Brain,
  RefreshCw,
  Trash2,
  ArrowLeft,
} from "lucide-react";
import Link from "next/link";

interface AgentMetric {
  agent: string;
  avgDuration: number;
  successRate: number;
  totalCalls: number;
}

interface SearchPattern {
  query: string;
  count: number;
  lastUsed: number;
}

interface AnalyticsSummary {
  totalEvents: number;
  eventCounts: Record<string, number>;
  recentEvents: Array<{
    name: string;
    properties?: Record<string, unknown>;
    timestamp: number;
  }>;
}

export default function DashboardPage() {
  const { isSignedIn, user } = useUser();
  const [summary, setSummary] = useState<AnalyticsSummary | null>(() => getAnalyticsSummary());
  const [agentMetrics, setAgentMetrics] = useState<AgentMetric[]>(() => getAgentMetrics());
  const [popularSearches, setPopularSearches] = useState<SearchPattern[]>(() => getPopularSearches(10));
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadData = useCallback(() => {
    setIsRefreshing(true);
    // Using setTimeout to batch the state updates
    setTimeout(() => {
      setSummary(getAnalyticsSummary());
      setAgentMetrics(getAgentMetrics());
      setPopularSearches(getPopularSearches(10));
      setIsRefreshing(false);
    }, 0);
  }, []);

  useEffect(() => {
    // Auto-refresh every 10 seconds
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleClearAnalytics = () => {
    if (confirm("Are you sure you want to clear all analytics data?")) {
      clearAnalytics();
      loadData();
    }
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black p-6">
      {/* Header */}
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link 
              href="/ai"
              className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
                Analytics Dashboard
              </h1>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {isSignedIn ? `Welcome, ${user?.firstName || 'User'}` : 'Development Analytics'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              disabled={isRefreshing}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={handleClearAnalytics}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Clear
            </button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <StatCard
            icon={<BarChart3 className="w-5 h-5 text-blue-600" />}
            label="Total Events"
            value={summary?.totalEvents || 0}
          />
          <StatCard
            icon={<Search className="w-5 h-5 text-green-600" />}
            label="Searches"
            value={summary?.eventCounts?.search_performed || 0}
          />
          <StatCard
            icon={<TrendingUp className="w-5 h-5 text-purple-600" />}
            label="Venue Views"
            value={summary?.eventCounts?.venue_viewed || 0}
          />
          <StatCard
            icon={<Clock className="w-5 h-5 text-orange-600" />}
            label="Agent Calls"
            value={summary?.eventCounts?.agent_completed || 0}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Agent Performance */}
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6">
            <div className="flex items-center gap-2 mb-4">
              <Brain className="w-5 h-5 text-purple-600" />
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                Agent Performance
              </h2>
            </div>
            {agentMetrics.length === 0 ? (
              <p className="text-sm text-zinc-500 text-center py-8">
                No agent metrics yet. Start using the AI chat!
              </p>
            ) : (
              <div className="space-y-3">
                {agentMetrics.map((metric) => (
                  <div
                    key={metric.agent}
                    className="flex items-center justify-between p-3 bg-zinc-50 dark:bg-zinc-800 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${
                        metric.successRate >= 90 ? 'bg-green-500' :
                        metric.successRate >= 70 ? 'bg-yellow-500' : 'bg-red-500'
                      }`} />
                      <span className="font-medium text-zinc-900 dark:text-zinc-50">
                        {metric.agent}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-zinc-600 dark:text-zinc-400">
                        {formatDuration(metric.avgDuration)}
                      </span>
                      <span className={`font-medium ${
                        metric.successRate >= 90 ? 'text-green-600' :
                        metric.successRate >= 70 ? 'text-yellow-600' : 'text-red-600'
                      }`}>
                        {metric.successRate}%
                      </span>
                      <span className="text-zinc-500">
                        {metric.totalCalls} calls
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Popular Searches */}
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6">
            <div className="flex items-center gap-2 mb-4">
              <Search className="w-5 h-5 text-green-600" />
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                Popular Searches
              </h2>
            </div>
            {popularSearches.length === 0 ? (
              <p className="text-sm text-zinc-500 text-center py-8">
                No searches recorded yet. Try searching for workspaces!
              </p>
            ) : (
              <div className="space-y-2">
                {popularSearches.map((search, index) => (
                  <div
                    key={search.query}
                    className="flex items-center justify-between p-3 bg-zinc-50 dark:bg-zinc-800 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-zinc-400">
                        #{index + 1}
                      </span>
                      <span className="text-zinc-900 dark:text-zinc-50 truncate max-w-[200px]">
                        {search.query}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full">
                        {search.count}x
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recent Events */}
        <div className="mt-6 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 mb-4">
            Recent Events
          </h2>
          {summary?.recentEvents.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-8">
              No events recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800">
                    <th className="text-left py-2 px-3 text-zinc-600 dark:text-zinc-400">Time</th>
                    <th className="text-left py-2 px-3 text-zinc-600 dark:text-zinc-400">Event</th>
                    <th className="text-left py-2 px-3 text-zinc-600 dark:text-zinc-400">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {summary?.recentEvents.slice().reverse().map((event, index) => (
                    <tr key={index} className="border-b border-zinc-100 dark:border-zinc-800/50">
                      <td className="py-2 px-3 text-zinc-500">
                        {formatTime(event.timestamp)}
                      </td>
                      <td className="py-2 px-3">
                        <span className="inline-flex items-center gap-1">
                          {event.name.includes('error') ? (
                            <XCircle className="w-3 h-3 text-red-500" />
                          ) : (
                            <CheckCircle className="w-3 h-3 text-green-500" />
                          )}
                          <span className="text-zinc-900 dark:text-zinc-50">
                            {event.name.replace(/_/g, ' ')}
                          </span>
                        </span>
                      </td>
                      <td className="py-2 px-3 text-zinc-500 truncate max-w-[300px]">
                        {event.properties ? JSON.stringify(event.properties).slice(0, 50) + '...' : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Event Distribution */}
        <div className="mt-6 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 mb-4">
            Event Distribution
          </h2>
          <div className="flex flex-wrap gap-3">
            {Object.entries(summary?.eventCounts || {}).map(([event, count]) => (
              <div
                key={event}
                className="flex items-center gap-2 px-3 py-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg"
              >
                <span className="text-zinc-700 dark:text-zinc-300">
                  {event.replace(/_/g, ' ')}
                </span>
                <span className="px-2 py-0.5 bg-blue-600 text-white text-xs rounded-full">
                  {count}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ 
  icon, 
  label, 
  value 
}: { 
  icon: React.ReactNode; 
  label: string; 
  value: number;
}) {
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
          {icon}
        </div>
        <div>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{label}</p>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{value}</p>
        </div>
      </div>
    </div>
  );
}
