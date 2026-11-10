import { BatteryFull, BatteryLow, BatteryMedium } from "lucide-react";
import {
  getBatteryLevel,
  normalizeBatteryPercent,
  type BatteryLevel,
} from "@/lib/peripherals/battery";

const LEVEL_STYLES: Record<
  BatteryLevel,
  { label: string; tone: string; Icon: typeof BatteryFull }
> = {
  good: {
    label: "good",
    tone: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
    Icon: BatteryFull,
  },
  medium: {
    label: "medium",
    tone: "text-amber-400 bg-amber-500/10 border-amber-500/30",
    Icon: BatteryMedium,
  },
  low: {
    label: "low",
    tone: "text-rose-400 bg-rose-500/10 border-rose-500/30",
    Icon: BatteryLow,
  },
};

interface BatteryIndicatorProps {
  percent: number | null | undefined;
  className?: string;
}

/** Battery icon and percentage badge: green above 50%, amber 20-50%, red below 20%. */
export function BatteryIndicator({
  percent,
  className = "",
}: BatteryIndicatorProps) {
  const value = normalizeBatteryPercent(percent);
  const level = getBatteryLevel(percent);
  if (value === null || level === null) return null;

  const { label, tone, Icon } = LEVEL_STYLES[level];

  return (
    <span
      role="img"
      data-testid="battery-indicator"
      data-level={level}
      aria-label={`Battery ${value}%, ${label}`}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-mono font-bold ${tone} ${className}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {value}%
    </span>
  );
}
