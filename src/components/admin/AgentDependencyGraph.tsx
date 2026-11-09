"use client";

import React, { useState, useMemo } from "react";
import { CheckCircle2, Clock, AlertCircle, PlayCircle } from "lucide-react";

export type AgentTaskStatus = "pending" | "executing" | "succeeded" | "failed";

export interface AgentTaskNode {
  id: string;
  label: string;
  agentName: string;
  status: AgentTaskStatus;
  durationMs?: number;
  dependencies?: string[];
  x?: number;
  y?: number;
}

export interface AgentWorkflowEdge {
  from: string;
  to: string;
}

export interface AgentDependencyGraphProps {
  nodes?: AgentTaskNode[];
  edges?: AgentWorkflowEdge[];
  selectedNodeId?: string | null;
  onSelectNode?: (node: AgentTaskNode) => void;
  className?: string;
  width?: number;
  height?: number;
}

export const DEFAULT_AGENT_NODES: AgentTaskNode[] = [
  {
    id: "telemetry-ingestion",
    label: "Telemetry Ingestion",
    agentName: "SensorStreamAgent",
    status: "succeeded",
    durationMs: 42,
    x: 100,
    y: 160,
  },
  {
    id: "noise-forecasting",
    label: "Noise Forecasting",
    agentName: "AcousticPredictor",
    status: "executing",
    durationMs: 185,
    dependencies: ["telemetry-ingestion"],
    x: 350,
    y: 80,
  },
  {
    id: "dynamic-pricing",
    label: "Dynamic Pricing",
    agentName: "YieldOptimizer",
    status: "pending",
    durationMs: 0,
    dependencies: ["noise-forecasting"],
    x: 600,
    y: 80,
  },
  {
    id: "push-notification",
    label: "Push Notification Delivery",
    agentName: "NomadDispatcher",
    status: "pending",
    durationMs: 0,
    dependencies: ["dynamic-pricing"],
    x: 850,
    y: 160,
  },
];

export const DEFAULT_AGENT_EDGES: AgentWorkflowEdge[] = [
  { from: "telemetry-ingestion", to: "noise-forecasting" },
  { from: "noise-forecasting", to: "dynamic-pricing" },
  { from: "dynamic-pricing", to: "push-notification" },
];

export const STATUS_THEMES: Record<
  AgentTaskStatus,
  {
    label: string;
    strokeColor: string;
    cardBg: string;
    border: string;
    badgeBg: string;
    badgeText: string;
    glow: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  executing: {
    label: "Executing",
    strokeColor: "#10b981", // Emerald
    cardBg: "bg-emerald-500/10 dark:bg-emerald-950/40",
    border: "border-emerald-500/60",
    badgeBg: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
    badgeText: "text-emerald-600 dark:text-emerald-400",
    glow: "shadow-[0_0_15px_rgba(16,185,129,0.35)]",
    icon: PlayCircle,
  },
  succeeded: {
    label: "Succeeded",
    strokeColor: "#10b981", // Emerald
    cardBg: "bg-emerald-500/5 dark:bg-emerald-950/20",
    border: "border-emerald-500/40",
    badgeBg: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    badgeText: "text-emerald-600 dark:text-emerald-400",
    glow: "shadow-[0_0_12px_rgba(16,185,129,0.25)]",
    icon: CheckCircle2,
  },
  pending: {
    label: "Pending",
    strokeColor: "#f59e0b", // Amber
    cardBg: "bg-amber-500/10 dark:bg-amber-950/30",
    border: "border-amber-500/50",
    badgeBg: "bg-amber-500/20 text-amber-700 dark:text-amber-300",
    badgeText: "text-amber-600 dark:text-amber-400",
    glow: "shadow-[0_0_10px_rgba(245,158,11,0.25)]",
    icon: Clock,
  },
  failed: {
    label: "Failed",
    strokeColor: "#ef4444", // Crimson
    cardBg: "bg-red-500/10 dark:bg-red-950/30",
    border: "border-red-500/60",
    badgeBg: "bg-red-500/20 text-red-700 dark:text-red-300",
    badgeText: "text-red-600 dark:text-red-400",
    glow: "shadow-[0_0_15px_rgba(239,68,68,0.35)]",
    icon: AlertCircle,
  },
};

/**
 * Calculates a smooth horizontal cubic Bezier curve connecting two DAG points.
 */
export function calculateBezierCurve(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string {
  const dx = (x2 - x1) * 0.5;
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

export function AgentDependencyGraph({
  nodes = DEFAULT_AGENT_NODES,
  edges = DEFAULT_AGENT_EDGES,
  selectedNodeId,
  onSelectNode,
  className = "",
  width = 1000,
  height = 360,
}: AgentDependencyGraphProps) {
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(
    selectedNodeId ?? null,
  );

  const activeId = selectedNodeId !== undefined ? selectedNodeId : internalSelectedId;

  const nodeMap = useMemo(() => {
    return new Map(nodes.map((n) => [n.id, n]));
  }, [nodes]);

  const handleNodeClick = (node: AgentTaskNode) => {
    setInternalSelectedId(node.id);
    onSelectNode?.(node);
  };

  const NODE_WIDTH = 180;
  const NODE_HEIGHT = 76;

  return (
    <div
      data-testid="agent-dag-container"
      className={`relative w-full overflow-x-auto rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-950 p-4 shadow-xl ${className}`}
    >
      <div className="flex items-center justify-between border-b border-zinc-800 pb-3 mb-2">
        <div>
          <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            Agent Task Dependency DAG
          </h3>
          <p className="text-xs text-zinc-400">
            Real-time background agent workflow execution graph
          </p>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" />
            <span className="text-zinc-300">Active / Succeeded</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500 shadow-sm shadow-amber-500/50" />
            <span className="text-zinc-300">Pending</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500 shadow-sm shadow-red-500/50" />
            <span className="text-zinc-300">Failed</span>
          </div>
        </div>
      </div>

      <svg
        data-testid="agent-dag-svg"
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto min-w-[750px] select-none"
      >
        <defs>
          <marker
            id="dag-arrow"
            viewBox="0 0 10 10"
            refX="6"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 8 5 L 0 9 z" fill="#64748b" />
          </marker>
          <marker
            id="dag-arrow-active"
            viewBox="0 0 10 10"
            refX="6"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 8 5 L 0 9 z" fill="#10b981" />
          </marker>
        </defs>

        {/* Render Bezier Curve Edges */}
        <g data-testid="dag-edges-group">
          {edges.map((edge) => {
            const source = nodeMap.get(edge.from);
            const target = nodeMap.get(edge.to);
            if (!source || !target) return null;

            const startX = (source.x ?? 0) + NODE_WIDTH;
            const startY = (source.y ?? 0) + NODE_HEIGHT / 2;
            const endX = target.x ?? 0;
            const endY = (target.y ?? 0) + NODE_HEIGHT / 2;

            const pathD = calculateBezierCurve(startX, startY, endX, endY);
            const isPathActive =
              source.status === "executing" || source.status === "succeeded";

            return (
              <path
                key={`edge-${edge.from}-${edge.to}`}
                data-testid={`dag-edge-${edge.from}-${edge.to}`}
                d={pathD}
                fill="none"
                stroke={isPathActive ? "#10b981" : "#475569"}
                strokeWidth={isPathActive ? 2.5 : 1.5}
                strokeDasharray={
                  source.status === "executing" ? "6,4" : undefined
                }
                markerEnd={isPathActive ? "url(#dag-arrow-active)" : "url(#dag-arrow)"}
                className={source.status === "executing" ? "animate-pulse" : ""}
              />
            );
          })}
        </g>

        {/* Render DAG Nodes */}
        <g data-testid="dag-nodes-group">
          {nodes.map((node) => {
            const theme = STATUS_THEMES[node.status] || STATUS_THEMES.pending;
            const isSelected = activeId === node.id;
            const Icon = theme.icon;
            const x = node.x ?? 100;
            const y = node.y ?? 100;

            return (
              <g
                key={node.id}
                data-testid={`dag-node-${node.id}`}
                transform={`translate(${x}, ${y})`}
                onClick={() => handleNodeClick(node)}
                className="cursor-pointer group"
              >
                {/* Node Box */}
                <rect
                  width={NODE_WIDTH}
                  height={NODE_HEIGHT}
                  rx={12}
                  className={`transition-all duration-200 fill-zinc-900/90 stroke-2 ${
                    isSelected
                      ? "stroke-sky-400 shadow-lg"
                      : node.status === "executing" || node.status === "succeeded"
                        ? "stroke-emerald-500/80"
                        : node.status === "failed"
                          ? "stroke-red-500/80"
                          : "stroke-amber-500/70"
                  }`}
                  style={{
                    filter: isSelected
                      ? "drop-shadow(0 0 10px rgba(56,189,248,0.5))"
                      : undefined,
                  }}
                />

                {/* Status Indicator Bar */}
                <rect
                  x={0}
                  y={0}
                  width={6}
                  height={NODE_HEIGHT}
                  rx={3}
                  fill={theme.strokeColor}
                />

                {/* Node Label & Agent Name */}
                <text
                  x={16}
                  y={24}
                  fill="#f8fafc"
                  fontSize="12"
                  fontWeight="bold"
                  className="font-sans select-none"
                >
                  {node.label}
                </text>
                <text
                  x={16}
                  y={40}
                  fill="#94a3b8"
                  fontSize="10"
                  className="font-mono select-none"
                >
                  {node.agentName}
                </text>

                {/* Status Badge */}
                <rect
                  x={16}
                  y={49}
                  width={62}
                  height={18}
                  rx={6}
                  fill={theme.strokeColor}
                  fillOpacity="0.2"
                />
                <text
                  x={22}
                  y={62}
                  fill={theme.strokeColor}
                  fontSize="9"
                  fontWeight="bold"
                  className="font-sans select-none uppercase"
                >
                  {theme.label}
                </text>

                {/* Execution Duration Badge */}
                <rect
                  x={84}
                  y={49}
                  width={56}
                  height={18}
                  rx={6}
                  fill="#334155"
                  fillOpacity="0.4"
                />
                <text
                  x={90}
                  y={62}
                  fill="#cbd5e1"
                  fontSize="9"
                  fontWeight="500"
                  className="font-mono select-none"
                >
                  {node.durationMs ?? 0}ms
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

export default AgentDependencyGraph;
