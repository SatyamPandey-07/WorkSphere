import React from "react";
import { Target } from "lucide-react";

export interface ClusterBadgeProps {
  cluster?: number;
  score?: number;
  showCluster?: boolean;
  showScore?: boolean;
  className?: string;
  onClick?: () => void;
}

export function ClusterBadge({
  cluster,
  score,
  showCluster = false,
  showScore = false,
  className = "",
  onClick,
}: ClusterBadgeProps) {
  // Normalize score: if finite number, clamp between 0 and 1 (if > 1, assume 0-100 percentage)
  let normalizedScore: number | null = null;
  if (typeof score === "number" && Number.isFinite(score)) {
    const s = score > 1 ? score / 100 : score;
    normalizedScore = Math.max(0, Math.min(1, s));
  }

  const label =
    normalizedScore !== null
      ? normalizedScore >= 0.9
        ? "Top Match"
        : normalizedScore >= 0.8
          ? "Great Match"
          : normalizedScore >= 0.6
            ? "Good Match"
            : "Match"
      : cluster != null
        ? `Cluster ${cluster}`
        : "Match";

  const percentText =
    normalizedScore !== null ? `${Math.round(normalizedScore * 100)}%` : null;

  const titleParts: string[] = [];
  if (cluster != null) titleParts.push(`Cluster ${cluster}`);
  titleParts.push(label);
  if (percentText) titleParts.push(`(${percentText})`);
  const tooltip = titleParts.join(" • ");

  return (
    <div
      role="status"
      aria-label={tooltip}
      title={tooltip}
      data-testid="cluster-badge"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 text-violet-600 dark:from-violet-400/10 dark:to-fuchsia-400/10 dark:text-violet-400 border border-violet-500/20 text-xs font-medium shadow-sm transition-all hover:shadow-md ${
        onClick ? "cursor-pointer" : ""
      } ${className}`.trim()}
    >
      <Target data-testid="cluster-badge-icon" className="w-3.5 h-3.5 shrink-0" />
      {showCluster && cluster != null && (
        <span data-testid="cluster-badge-cluster" className="font-semibold">
          C{cluster}:
        </span>
      )}
      <span data-testid="cluster-badge-label">{label}</span>
      {showScore && percentText && (
        <span
          data-testid="cluster-badge-score"
          className="text-[10px] opacity-80"
        >
          ({percentText})
        </span>
      )}
    </div>
  );
}

export default ClusterBadge;
