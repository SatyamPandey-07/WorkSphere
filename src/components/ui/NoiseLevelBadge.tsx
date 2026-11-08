import React from "react";
import { Volume1, Volume2, Plane } from "lucide-react";

export type NoiseLevelTier = "quiet" | "moderate" | "loud";

export interface NoiseLevelInfo {
  tier: NoiseLevelTier;
  label: string;
  shortLabel: string;
  decibelRange: string;
  description: string;
}

export function parseNoiseLevel(
  level?: string | number | null,
): NoiseLevelTier | null {
  if (level === null || level === undefined) return null;
  if (typeof level === "number") {
    if (isNaN(level) || level <= 0) return null;
    if (level < 50) return "quiet";
    if (level <= 70) return "moderate";
    return "loud";
  }
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

  const numericMatch = normalized.match(/^(\d+(?:\.\d+)?)/);
  if (numericMatch) {
    const dB = parseFloat(numericMatch[1]);
    if (dB < 50) return "quiet";
    if (dB <= 70) return "moderate";
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
  noiseLevel?: string | number | null;
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
        <Volume1
          className={size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5"}
          aria-hidden="true"
        />
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
      data-testid="noise-level-badge"
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

// ============================================================================
// Aerospace Mach Speed Classification Badge (#6175)
// ============================================================================

export type MachSpeedTier = "subsonic" | "supersonic" | "hypersonic";

export interface MachSpeedInfo {
  tier: MachSpeedTier;
  label: string;
  shortLabel: string;
  speedRange: string;
  machRating: string;
  description: string;
}

/**
 * Maps venue download speed (Mbps) to aerospace Mach classification tiers:
 * - Subsonic: < 50 Mbps
 * - Supersonic: 50 - 250 Mbps
 * - Hypersonic Mach 5: > 250 Mbps
 */
export function getMachSpeedTier(
  downloadMbps?: number | null,
): MachSpeedTier | null {
  if (
    downloadMbps === null ||
    downloadMbps === undefined ||
    typeof downloadMbps !== "number" ||
    isNaN(downloadMbps) ||
    downloadMbps <= 0
  ) {
    return null;
  }
  if (downloadMbps < 50) {
    return "subsonic";
  }
  if (downloadMbps <= 250) {
    return "supersonic";
  }
  return "hypersonic";
}

/**
 * Parses numeric or string speed representations into a MachSpeedTier.
 */
export function parseMachSpeed(
  speed?: number | string | null,
): MachSpeedTier | null {
  if (speed === null || speed === undefined) return null;
  if (typeof speed === "number") {
    return getMachSpeedTier(speed);
  }
  const numericVal = parseFloat(speed);
  return isNaN(numericVal) ? null : getMachSpeedTier(numericVal);
}

export const MACH_SPEED_MAP: Record<MachSpeedTier, MachSpeedInfo> = {
  subsonic: {
    tier: "subsonic",
    label: "Subsonic (<50 Mbps)",
    shortLabel: "Subsonic",
    speedRange: "<50 Mbps",
    machRating: "Subsonic (< Mach 1)",
    description:
      "Standard WiFi bandwidth suitable for light browsing & messaging",
  },
  supersonic: {
    tier: "supersonic",
    label: "Supersonic (50-250 Mbps)",
    shortLabel: "Supersonic",
    speedRange: "50-250 Mbps",
    machRating: "Supersonic (Mach 1-3)",
    description:
      "High-speed broadband for HD multi-party video conferencing & live streaming",
  },
  hypersonic: {
    tier: "hypersonic",
    label: "Hypersonic Mach 5 (>250 Mbps)",
    shortLabel: "Hypersonic Mach 5",
    speedRange: ">250 Mbps",
    machRating: "Hypersonic (Mach 5+)",
    description:
      "Extreme gigabit bandwidth for massive cloud workloads & high-speed engineering",
  },
};

export interface MachSpeedBadgeProps {
  downloadMbps?: number | null;
  uploadMbps?: number | null;
  speed?: number | string | null;
  variant?: "default" | "compact" | "subtle";
  size?: "sm" | "md" | "lg";
  showUnknown?: boolean;
  className?: string;
}

export function MachSpeedBadge({
  downloadMbps,
  uploadMbps,
  speed,
  variant = "default",
  size = "md",
  showUnknown = false,
  className = "",
}: MachSpeedBadgeProps) {
  const effectiveDownload =
    typeof downloadMbps === "number"
      ? downloadMbps
      : typeof speed === "number"
        ? speed
        : typeof speed === "string"
          ? parseFloat(speed) || null
          : null;

  const tier = getMachSpeedTier(effectiveDownload);

  if (!tier) {
    if (!showUnknown) return null;

    return (
      <span
        role="status"
        aria-label="Aerospace WiFi speed: Unknown"
        className={`inline-flex items-center gap-1.5 rounded-full border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 text-zinc-500 dark:text-zinc-400 font-medium ${
          size === "sm"
            ? "px-2 py-0.5 text-[11px]"
            : size === "lg"
              ? "px-3.5 py-1 text-sm"
              : "px-2.5 py-0.5 text-xs"
        } ${className}`}
      >
        <Plane
          className={size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5"}
          aria-hidden="true"
        />
        <span>Unknown Speed</span>
      </span>
    );
  }

  const info = MACH_SPEED_MAP[tier];

  // Aerospace color-coded speed styles
  const tierStyles: Record<MachSpeedTier, string> = {
    subsonic:
      variant === "subtle"
        ? "bg-transparent text-sky-700 dark:text-sky-400"
        : "border-sky-200/80 bg-sky-50 text-sky-700 dark:border-sky-800/60 dark:bg-sky-950/40 dark:text-sky-300",
    supersonic:
      variant === "subtle"
        ? "bg-transparent text-violet-700 dark:text-violet-400"
        : "border-violet-200/80 bg-violet-50 text-violet-700 dark:border-violet-800/60 dark:bg-violet-950/40 dark:text-violet-300",
    hypersonic:
      variant === "subtle"
        ? "bg-transparent text-emerald-700 dark:text-emerald-400"
        : "border-emerald-200/80 bg-emerald-50 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300 shadow-xs",
  };

  const dotStyles: Record<MachSpeedTier, string> = {
    subsonic: "bg-sky-500",
    supersonic: "bg-violet-500",
    hypersonic: "bg-emerald-400 animate-pulse",
  };

  const jetIconColors: Record<MachSpeedTier, string> = {
    subsonic: "text-sky-600 dark:text-sky-400",
    supersonic: "text-violet-600 dark:text-violet-400",
    hypersonic: "text-emerald-600 dark:text-emerald-300",
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

  const labelText = variant === "compact" ? info.shortLabel : info.label;

  // Build exact verified speeds summary for accessible tooltip
  const speedSpecs = [
    effectiveDownload ? `${effectiveDownload} Mbps down` : null,
    typeof uploadMbps === "number" ? `${uploadMbps} Mbps up` : null,
  ]
    .filter(Boolean)
    .join(" / ");

  const tooltipSummary = speedSpecs
    ? `Verified WiFi: ${speedSpecs} · ${info.label} (${info.machRating}) - ${info.description}`
    : `Verified WiFi: ${info.label} (${info.machRating}) - ${info.description}`;

  return (
    <div className="group relative inline-flex items-center">
      <span
        role="status"
        data-testid="mach-speed-badge"
        aria-label={`Aerospace WiFi speed: ${info.label}${speedSpecs ? ` (${speedSpecs})` : ""}`}
        className={`inline-flex items-center rounded-full font-medium transition-colors cursor-help ${
          variant !== "subtle" ? "border shadow-xs" : ""
        } ${sizeClasses[size]} ${tierStyles[tier]} ${className}`}
        title={tooltipSummary}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotStyles[tier]}`}
          aria-hidden="true"
        />
        <Plane
          data-testid="jet-icon"
          className={`${iconSizes[size]} shrink-0 ${jetIconColors[tier]}`}
          aria-hidden="true"
        />
        <span className="font-semibold">{labelText}</span>
      </span>

      {/* Accessible Hover Tooltip with Exact Verified Download/Upload Speeds */}
      <div
        role="tooltip"
        data-testid="mach-speed-tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:flex group-focus-within:flex flex-col gap-1 w-60 p-2.5 rounded-xl bg-zinc-900 text-zinc-100 text-xs shadow-xl border border-zinc-700 z-50 transition-opacity"
      >
        <div className="font-semibold flex items-center justify-between text-zinc-200 border-b border-zinc-800 pb-1.5">
          <span className="flex items-center gap-1.5">
            <Plane
              className="w-3.5 h-3.5 text-sky-400 shrink-0"
              aria-hidden="true"
            />
            <span>{info.shortLabel}</span>
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono">
            {info.machRating}
          </span>
        </div>

        <div className="text-[11px] space-y-1 pt-0.5">
          {effectiveDownload && (
            <div className="flex justify-between items-center">
              <span className="text-zinc-400">Verified Down:</span>
              <span className="font-mono font-bold text-emerald-400">
                {effectiveDownload} Mbps
              </span>
            </div>
          )}
          {typeof uploadMbps === "number" && (
            <div className="flex justify-between items-center">
              <span className="text-zinc-400">Verified Up:</span>
              <span className="font-mono font-bold text-sky-400">
                {uploadMbps} Mbps
              </span>
            </div>
          )}
          <p className="text-[10px] text-zinc-400 leading-tight pt-1 border-t border-zinc-800/80">
            {info.description}
          </p>
        </div>
      </div>
    </div>
  );
}
