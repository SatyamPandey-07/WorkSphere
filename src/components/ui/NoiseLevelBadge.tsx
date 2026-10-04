import React from "react";
import { Volume1, Volume2 } from "lucide-react";

export type NoiseLevelTier = "quiet" | "moderate" | "loud";

export interface NoiseLevelInfo {
  tier: NoiseLevelTier;
  label: string;
  shortLabel: string;
  decibelRange: string;
  description: string;
}

export function parseNoiseLevel(level?: string | null): NoiseLevelTier | null {
  if (!level) return null;
  const normalized = level.trim().toLowerCase();
  if (
    normalized === "quiet" ||
    normalized === "silent" ||
    normalized === "calm"
  ) {
    return "quiet";
  }
  if (
    normalized === "moderate" ||
    normalized === "medium" ||
    normalized === "average"
  ) {
    return "moderate";
  }
  if (
    normalized === "loud" ||
    normalized === "noisy" ||
    normalized === "lively" ||
    normalized === "energetic" ||
    normalized === "high"
  ) {
    return "loud";
  }
  return null;
}

export const NOISE_LEVEL_MAP: Record<NoiseLevelTier, NoiseLevelInfo> = {
  quiet: {
    tier: "quiet",
    label: "Quiet Focus",
    shortLabel: "Quiet",
    decibelRange: "< 50 dB",
    description: "Ideal for deep focus and quiet calls",
  },
  moderate: {
    tier: "moderate",
    label: "Moderate Ambience",
    shortLabel: "Moderate",
    decibelRange: "50-70 dB",
    description: "Standard cafe or coworking background chatter",
  },
  loud: {
    tier: "loud",
    label: "Lively & Energetic",
    shortLabel: "Lively",
    decibelRange: "> 70 dB",
    description: "Bustling social atmosphere with music and conversation",
  },
};

export interface NoiseLevelBadgeProps {
  noiseLevel?: string | null;
  showDecibels?: boolean;
  variant?: "default" | "compact" | "subtle";
  size?: "sm" | "md" | "lg";
  showUnknown?: boolean;
  className?: string;
}

export function NoiseLevelBadge({
  noiseLevel,
  showDecibels = false,
  variant = "default",
  size = "md",
  showUnknown = false,
  className = "",
}: NoiseLevelBadgeProps) {
  const tier = parseNoiseLevel(noiseLevel);

  if (!tier) {
    if (!showUnknown) return null;

    return (
      <span
        role="status"
        aria-label="Ambient noise level: Unknown"
        className={`inline-flex items-center gap-1.5 rounded-full border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 text-zinc-500 dark:text-zinc-400 font-medium ${
          size === "sm"
            ? "px-2 py-0.5 text-[11px]"
            : size === "lg"
              ? "px-3.5 py-1 text-sm"
              : "px-2.5 py-0.5 text-xs"
        } ${className}`}
      >
        <Volume1 className={size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5"} aria-hidden="true" />
        <span>Unknown Noise</span>
      </span>
    );
  }

  const info = NOISE_LEVEL_MAP[tier];

  // Visual styles by tier
  const tierStyles: Record<NoiseLevelTier, string> = {
    quiet:
      variant === "subtle"
        ? "bg-transparent text-emerald-700 dark:text-emerald-400"
        : "border-emerald-200/80 bg-emerald-50 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300",
    moderate:
      variant === "subtle"
        ? "bg-transparent text-amber-700 dark:text-amber-400"
        : "border-amber-200/80 bg-amber-50 text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-300",
    loud:
      variant === "subtle"
        ? "bg-transparent text-rose-700 dark:text-rose-400"
        : "border-rose-200/80 bg-rose-50 text-rose-700 dark:border-rose-800/60 dark:bg-rose-950/40 dark:text-rose-300",
  };

  const dotStyles: Record<NoiseLevelTier, string> = {
    quiet: "bg-emerald-500",
    moderate: "bg-amber-500",
    loud: "bg-rose-500",
  };

  const sizeClasses = {
    sm: "px-2 py-0.5 text-[11px] gap-1",
    md: "px-2.5 py-0.5 text-xs gap-1.5",
    lg: "px-3.5 py-1 text-sm gap-2",
  };

  const iconSizes = {
    sm: "h-3 w-3",
    md: "h-3.5 w-3.5",
    lg: "h-4 w-4",
  };

  const IconComponent = tier === "quiet" ? Volume1 : Volume2;

  const labelText = variant === "compact" ? info.shortLabel : info.label;

  return (
    <span
      role="status"
      aria-label={`Ambient noise level: ${info.label} (${info.decibelRange})`}
      className={`inline-flex items-center rounded-full font-medium transition-colors ${
        variant !== "subtle" ? "border shadow-xs" : ""
      } ${sizeClasses[size]} ${tierStyles[tier]} ${className}`}
      title={`${info.label} (${info.decibelRange}): ${info.description}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotStyles[tier]}`}
        aria-hidden="true"
      />
      <IconComponent
        className={`${iconSizes[size]} shrink-0 opacity-80`}
        aria-hidden="true"
      />
      <span className="font-semibold">{labelText}</span>
      {showDecibels && (
        <span className="opacity-75 font-normal text-[0.9em]">
          ({info.decibelRange})
        </span>
      )}
    </span>
  );
}
