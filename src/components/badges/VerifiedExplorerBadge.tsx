"use client";

import { useState, useEffect, useRef } from "react";
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
  className?: string;
  testId?: string;
  onTooltipToggle?: (isOpen: boolean) => void;
}

export function VerifiedExplorerBadge({
  refreshKey,
  description = "Verified Explorer: Verified nomad with 5+ verified coworking venue check-ins.",
  earned: propEarned,
  className = "",
  testId,
  onTooltipToggle,
}: VerifiedExplorerBadgeProps) {
  const [data, setData] = useState<BadgeData | null>(
    propEarned !== undefined
      ? { earned: propEarned, progress: propEarned ? 5 : 0, target: 5 }
      : null,
  );
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchBadge() {
      try {
        const res = await fetch("/api/user/badges");
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = await res.json();
        if (!cancelled && json && json.success && Array.isArray(json.badges)) {
          const badge = json.badges.find(
            (b: any) => b && b.id === "verified_explorer",
          );
          if (badge) {
            const rawProgress =
              typeof badge.progress === "number" ? badge.progress : 0;
            const rawTarget =
              typeof badge.target === "number" && badge.target > 0
                ? badge.target
                : 5;
            setData({
              earned: Boolean(badge.earned),
              progress: Math.max(0, rawProgress),
              target: rawTarget,
            });
          }
        }
      } catch {
        if (!cancelled && propEarned === undefined) {
          setData(null);
        }
      }
    }

    if (propEarned !== undefined) {
      setData({
        earned: propEarned,
        progress: propEarned ? 5 : 0,
        target: 5,
      });
    } else {
      fetchBadge();
    }

    return () => {
      cancelled = true;
    };
  }, [refreshKey, propEarned]);

  const toggleTooltip = (nextState?: boolean) => {
    const updated = typeof nextState === "boolean" ? nextState : !isTooltipOpen;
    setIsTooltipOpen(updated);
    onTooltipToggle?.(updated);
  };

  if (!data) return null;

  const safeTarget = data.target > 0 ? data.target : 1;
  const safeProgress = Math.max(0, data.progress);
  const progressPercent = Math.min(
    100,
    Math.max(0, (safeProgress / safeTarget) * 100),
  );

  const badgeContent = (
    <div
      role="button"
      aria-haspopup="dialog"
      aria-expanded={isTooltipOpen}
      aria-label={
        data.earned
          ? "Verified Explorer Badge (Earned)"
          : `Verified Explorer Badge (${data.progress} of ${data.target})`
      }
      data-testid={testId || "verified-explorer-badge"}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold cursor-help transition-colors select-none ${
        data.earned
          ? "bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400"
          : "bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400"
      } ${className}`.trim()}
      tabIndex={0}
      onMouseEnter={() => toggleTooltip(true)}
      onMouseLeave={() => toggleTooltip(false)}
      onFocus={() => toggleTooltip(true)}
      onBlur={() => toggleTooltip(false)}
      onClick={() => toggleTooltip()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleTooltip();
        } else if (e.key === "Escape") {
          toggleTooltip(false);
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
          data-testid="badge-tooltip"
          className="absolute top-full mt-2 left-1/2 -translate-x-1/2 z-50 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl w-64 max-w-xs animate-in fade-in zoom-in-95 duration-150"
        >
          <span className="font-semibold text-zinc-900 dark:text-zinc-100 block mb-1">
            Verified Explorer
          </span>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-2 leading-relaxed">
            {description}
          </p>
          <div className="w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-1.5 overflow-hidden">
            <div
              data-testid="badge-progress-bar"
              className={`h-full rounded-full transition-all duration-300 ${
                data.earned ? "bg-amber-400" : "bg-blue-500"
              }`}
              style={{
                width: `${progressPercent}%`,
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

export default VerifiedExplorerBadge;
