"use client";

import { useState, useEffect } from "react";
import { BadgeCheck, Compass } from "lucide-react";

interface BadgeData {
  earned: boolean;
  progress: number;
  target: number;
}

export interface VerifiedExplorerBadgeProps {
  refreshKey?: number;
  description?: string;
  earned?: boolean;
}

export function VerifiedExplorerBadge({
  refreshKey,
  description = "Verified Explorer: Verified nomad with 5+ verified coworking venue check-ins.",
  earned: propEarned,
}: VerifiedExplorerBadgeProps) {
  const [data, setData] = useState<BadgeData | null>(
    propEarned !== undefined ? { earned: propEarned, progress: 5, target: 5 } : null,
  );
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchBadge() {
      try {
        const res = await fetch("/api/user/badges");
        const json = await res.json();
        if (!cancelled && json.success) {
          const badge = json.badges.find(
            (b: any) => b.id === "verified_explorer",
          );
          if (badge)
            setData({
              earned: badge.earned,
              progress: badge.progress,
              target: badge.target,
            });
        }
      } catch {
        if (!cancelled && propEarned === undefined) setData(null);
      }
    }

    fetchBadge();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, propEarned]);

  if (!data) return null;

  const badgeContent = (
    <div
      role="button"
      aria-haspopup="dialog"
      aria-expanded={isTooltipOpen}
      aria-label="Verified Explorer Badge"
      className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold cursor-help transition-colors select-none ${
        data.earned
          ? "bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400"
          : "bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400"
      }`}
      tabIndex={0}
      onMouseEnter={() => setIsTooltipOpen(true)}
      onMouseLeave={() => setIsTooltipOpen(false)}
      onFocus={() => setIsTooltipOpen(true)}
      onBlur={() => setIsTooltipOpen(false)}
      onClick={() => setIsTooltipOpen((prev) => !prev)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setIsTooltipOpen((prev) => !prev);
        } else if (e.key === "Escape") {
          setIsTooltipOpen(false);
        }
      }}
    >
      {data.earned ? (
        <BadgeCheck className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
      ) : (
        <Compass className="w-3.5 h-3.5" />
      )}
      <span>
        {data.earned
          ? "Verified Explorer"
          : `Explorer (${data.progress}/${data.target})`}
      </span>
    </div>
  );

  return (
    <div className="relative inline-flex">
      {badgeContent}
      {isTooltipOpen && (
        <div
          role="tooltip"
          aria-live="polite"
          className="absolute top-full mt-2 left-1/2 -translate-x-1/2 z-50 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl w-64 max-w-xs animate-in fade-in zoom-in-95 duration-150"
        >
          <span className="font-semibold text-zinc-900 dark:text-zinc-100 block mb-1">
            Verified Explorer
          </span>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-2 leading-relaxed">
            {description}
          </p>
          <div className="w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-1.5">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                data.earned ? "bg-amber-400" : "bg-blue-500"
              }`}
              style={{
                width: `${Math.min(100, Math.max(0, (data.progress / data.target) * 100))}%`,
              }}
            />
          </div>
          <div className="flex justify-between mt-1 text-[10px] font-mono text-zinc-500 dark:text-zinc-400">
            <span>Progress</span>
            <span>
              {data.progress} / {data.target}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
