"use client";

import { useId, useState } from "react";
import { Volume2 } from "lucide-react";
import {
  parseNoiseLevel,
  type NoiseLevelTier,
} from "@/components/ui/NoiseLevelBadge";
import {
  clampDecibels,
  MAX_ACOUSTIC_DB,
  MIN_ACOUSTIC_DB,
} from "@/lib/spatial/acousticGradientEngine";

type BandId = "bass" | "mid" | "treble";

interface SpectrumBand {
  id: BandId;
  label: string;
  levelDb: number;
  colorClass: string;
}

interface BandDefinition {
  id: BandId;
  label: string;
  offsetDb: number;
  colorClass: string;
}

export interface VenueSoundBadgeProps {
  noiseLevel: string | number;
  size?: "compact" | "regular";
}

const REPRESENTATIVE_DB_BY_TIER: Record<NoiseLevelTier, number> = {
  quiet: 42,
  moderate: 58,
  loud: 76,
};

const BAND_DEFINITIONS: BandDefinition[] = [
  { id: "bass", label: "Bass (low)", offsetDb: -8, colorClass: "bg-sky-400" },
  {
    id: "mid",
    label: "Mid (medium)",
    offsetDb: 0,
    colorClass: "bg-emerald-400",
  },
  {
    id: "treble",
    label: "Treble (high)",
    offsetDb: -12,
    colorClass: "bg-rose-400",
  },
];

function getNumericNoiseLevel(noiseLevel: string | number): number | null {
  if (typeof noiseLevel === "number") {
    return Number.isFinite(noiseLevel) && noiseLevel > 0
      ? clampDecibels(noiseLevel)
      : null;
  }

  const numericMatch = noiseLevel
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*(?:dba?)?$/i);
  if (!numericMatch) return null;

  const decibels = Number(numericMatch[1]);
  return Number.isFinite(decibels) && decibels > 0
    ? clampDecibels(decibels)
    : null;
}

function getIllustrativeSpectrum(
  noiseLevel: string | number,
  tier: NoiseLevelTier | null,
): SpectrumBand[] | null {
  if (!tier) return null;

  // Category baselines match the existing ambient visualizer; band offsets are illustrative only.
  const overallDb =
    getNumericNoiseLevel(noiseLevel) ?? REPRESENTATIVE_DB_BY_TIER[tier];

  return BAND_DEFINITIONS.map((band) => ({
    ...band,
    levelDb: Math.round(clampDecibels(overallDb + band.offsetDb)),
  }));
}

function getBarWidth(levelDb: number): number {
  return (
    ((levelDb - MIN_ACOUSTIC_DB) / (MAX_ACOUSTIC_DB - MIN_ACOUSTIC_DB)) * 100
  );
}

export function VenueSoundBadge({
  noiseLevel,
  size = "compact",
}: VenueSoundBadgeProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const tooltipId = useId();
  const tier = parseNoiseLevel(noiseLevel);
  const spectrum = getIllustrativeSpectrum(noiseLevel, tier);
  const normalizedNoiseLevel = String(noiseLevel).trim().toLowerCase();
  const iconColor =
    normalizedNoiseLevel === "quiet"
      ? "text-green-600"
      : normalizedNoiseLevel === "moderate"
        ? "text-orange-600"
        : "text-red-600";
  const iconSize = size === "compact" ? "w-3.5 h-3.5" : "w-4 h-4";
  const labelSize =
    size === "compact" ? "max-w-[200px]" : "max-w-[140px] sm:max-w-[180px]";
  const isOpen = isHovered || isFocused;

  return (
    <span
      className="relative inline-flex items-center gap-1.5"
      data-testid="venue-sound-badge-container"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={(event) => {
        const nextTarget = event.relatedTarget;
        if (
          !(nextTarget instanceof Node) ||
          !event.currentTarget.contains(nextTarget)
        ) {
          setIsHovered(false);
        }
      }}
    >
      <span
        role="img"
        tabIndex={0}
        data-testid="venue-sound-badge"
        aria-label={`Ambient noise level: ${noiseLevel}`}
        aria-describedby={isOpen ? tooltipId : undefined}
        className="inline-flex cursor-help items-center gap-1.5 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-600 dark:focus-visible:outline-cyan-300"
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setIsHovered(false);
            setIsFocused(false);
          }
        }}
      >
        <Volume2 className={`${iconSize} shrink-0 ${iconColor}`} aria-hidden />
        <span className={`capitalize truncate ${labelSize}`}>{noiseLevel}</span>
      </span>

      <span
        id={tooltipId}
        role="tooltip"
        aria-labelledby={`${tooltipId}-title`}
        aria-hidden={!isOpen}
        data-testid="venue-sound-tooltip"
        data-state={isOpen ? "open" : "closed"}
        className={`pointer-events-none invisible absolute bottom-full left-0 z-50 w-60 translate-y-1 pb-2 opacity-0 transition-all duration-150 ease-out motion-reduce:transition-none ${
          isOpen ? "pointer-events-auto visible translate-y-0 opacity-100" : ""
        }`}
      >
        <span className="block rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-zinc-100 shadow-xl">
          <span
            id={`${tooltipId}-title`}
            className="block text-xs font-semibold"
          >
            Illustrative frequency spectrum
          </span>
          <span className="mt-1 block text-[10px] leading-snug text-zinc-300">
            Estimates from the overall noise level only; this badge has no
            measured frequency-band data.
          </span>

          {spectrum ? (
            <span className="mt-3 grid grid-cols-3 gap-2">
              {spectrum.map((band) => (
                <span
                  key={band.id}
                  className="flex min-w-0 flex-col items-center gap-1 text-center"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-10 w-full items-end overflow-hidden rounded bg-zinc-800"
                  >
                    <span
                      data-testid={`spectrum-bar-${band.id}`}
                      data-level-db={band.levelDb}
                      className={`w-full rounded-t transition-[height] duration-150 motion-reduce:transition-none ${band.colorClass}`}
                      style={{
                        height: `${getBarWidth(band.levelDb)}%`,
                      }}
                    />
                  </span>
                  <span className="text-[9px] leading-tight text-zinc-200">
                    {band.label}
                  </span>
                  <span className="font-mono text-[10px] font-semibold text-white">
                    {band.levelDb} dB
                  </span>
                </span>
              ))}
            </span>
          ) : (
            <span className="mt-2 block text-[10px] text-zinc-300">
              No estimate is available for this noise-level value.
            </span>
          )}
        </span>
      </span>
    </span>
  );
}
