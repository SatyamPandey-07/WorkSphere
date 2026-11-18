'use client';

import React from 'react';
import { Activity, Cpu, Clock, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import {
    AgentHeartbeatIndicator,
    evaluateAgentHeartbeat,
} from '@/components/admin/AgentHeartbeatIndicator';

export interface MonitoredAgentMetrics {
    id: string;
    name: string;
    role: string;
    model: string;
    lastHeartbeatAt: string | Date | null;
    avgLatencyMs: number;
    requestsPerMin: number;
    errorRatePercent: number;
    activeTasks: number;
}

interface AgentMonitoringTableProps {
    agents: MonitoredAgentMetrics[];
    isLoading?: boolean;
}

export function AgentMonitoringTable({
    agents,
    isLoading = false,
}: AgentMonitoringTableProps) {
    if (isLoading) {
        return (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-6">
                <div className="h-5 w-48 animate-pulse rounded bg-zinc-800" />
                <div className="mt-4 space-y-3">
                    {[1, 2, 3, 4, 5].map((idx) => (
                        <div key={idx} className="h-12 w-full animate-pulse rounded-lg bg-zinc-900" />
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/80 shadow-lg">
            <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
                <div className="flex items-center gap-2.5">
                    <Activity className="h-5 w-5 text-violet-400" />
                    <div>
                        <h2 className="text-sm font-semibold text-zinc-100">
                            Autonomous Multi-Agent Pipeline Telemetry
                        </h2>
                        <p className="text-xs text-zinc-400">
              Live heartbeat connectivity (≤15s active, >15s delayed, >30s stale)
                        </p>
                    </div>
                </div>

                <div className="hidden items-center gap-4 text-xs text-zinc-400 sm:flex">
                    <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        Active (≤15s)
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-amber-400" />
            Delayed (>15s)
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-rose-500" />
            Stale (>30s)
                    </span>
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                    <thead>
                        <tr className="border-b border-zinc-800/80 bg-zinc-900/50 text-xs uppercase tracking-wider text-zinc-400">
                            <th className="px-5 py-3 font-medium">Autonomous Agent</th>
                            <th className="px-4 py-3 font-medium">Model / Runtime</th>
                            <th className="px-4 py-3 font-medium">Connectivity</th>
                            <th className="px-4 py-3 font-medium text-right">Avg Latency</th>
                            <th className="px-4 py-3 font-medium text-right">Throughput</th>
                            <th className="px-5 py-3 font-medium text-right">Active Tasks</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60">
                        {agents.map((agent) => {
                            const status = evaluateAgentHeartbeat(agent.lastHeartbeatAt);

                            return (
                                <tr
                                    key={agent.id}
                                    className="transition-colors hover:bg-zinc-900/40"
                                >
                                    <td className="px-5 py-3.5">
                                        <div className="flex items-center gap-2.5">
                                            <AgentHeartbeatIndicator
                                                agentName={agent.name}
                                                lastHeartbeatAt={agent.lastHeartbeatAt}
                                            />
                                            <div>
                                                <div className="font-medium text-zinc-100">
                                                    {agent.name}
                                                </div>
                                                <div className="text-xs text-zinc-400">{agent.role}</div>
                                            </div>
                                        </div>
                                    </td>

                                    <td className="px-4 py-3.5">
                                        <span className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1 font-mono text-xs text-zinc-300">
                                            <Cpu className="h-3.5 w-3.5 text-violet-400" />
                                            {agent.model}
                                        </span>
                                    </td>

                                    <td className="px-4 py-3.5">
                                        {status.health === 'active' && (
                                            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
                                                <CheckCircle2 className="h-3.5 w-3.5" />
                                                Connected
                                            </span>
                                        )}
                                        {status.health === 'delayed' && (
                                            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-300">
                                                <AlertTriangle className="h-3.5 w-3.5" />
                                                Delayed
                                            </span>
                                        )}
                                        {status.health === 'stale' && (
                                            <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-0.5 text-xs font-medium text-rose-300">
                                                <XCircle className="h-3.5 w-3.5" />
                                                Stale
                                            </span>
                                        )}
                                    </td>

                                    <td className="px-4 py-3.5 text-right font-mono text-xs text-zinc-200">
                                        <span className="inline-flex items-center justify-end gap-1">
                                            <Clock className="h-3.5 w-3.5 text-zinc-500" />
                                            {agent.avgLatencyMs} ms
                                        </span>
                                    </td>

                                    <td className="px-4 py-3.5 text-right font-mono text-xs text-zinc-200">
                                        {agent.requestsPerMin} req/m
                                    </td>

                                    <td className="px-5 py-3.5 text-right font-mono text-xs text-zinc-200">
                                        {agent.activeTasks}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}