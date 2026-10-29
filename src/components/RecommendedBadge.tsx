import React from "react";
import { Sparkles } from "lucide-react";

export interface RecommendedBadgeProps {
  label?: string;
  compact?: boolean;
  showIcon?: boolean;
  className?: string;
  onClick?: () => void;
}

export function RecommendedBadge({
  label,
  compact = false,
  showIcon = true,
  className = "",
  onClick,
}: RecommendedBadgeProps = {}) {
  const displayText = label || (compact ? "Recommended" : "Recommended for You");

  return (
    <div
      role="status"
      aria-label={displayText}
      title={displayText}
      data-testid="recommended-badge"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-gradient-to-r from-amber-500/10 to-orange-500/10 text-amber-600 dark:from-amber-400/10 dark:to-orange-400/10 dark:text-amber-400 border border-amber-500/20 text-xs font-medium shadow-sm transition-all hover:shadow-md ${
        onClick ? "cursor-pointer" : ""
      } ${className}`.trim()}
    >
      {showIcon && (
        <Sparkles data-testid="recommended-badge-icon" className="w-3.5 h-3.5 shrink-0" />
      )}
      <span data-testid="recommended-badge-label">{displayText}</span>
    </div>
  );
}

export default RecommendedBadge;
