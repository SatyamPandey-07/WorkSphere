import React from "react";
import { Target } from "lucide-react";

interface ClusterBadgeProps {
  cluster?: number;
  score?: number;
}

export function ClusterBadge({ cluster, score }: ClusterBadgeProps) {
  const label =
    score != null && score > 0.9
      ? "Top Match"
      : score != null && score > 0.8
        ? "Great Match"
        : "Good Match";

  return (
    <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 text-violet-600 dark:from-violet-400/10 dark:to-fuchsia-400/10 dark:text-violet-400 border border-violet-500/20 text-xs font-medium shadow-sm transition-all hover:shadow-md">
      <Target className="w-3.5 h-3.5" />
      <span>{label}</span>
    </div>
  );
}
