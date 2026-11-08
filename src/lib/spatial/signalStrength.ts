/**
 * signalStrength.ts
 * Signal strength mapping utilities for BLE proximity and RSSI diagnostics.
 *
 * Maps Received Signal Strength Indication (RSSI in dBm) to 5-bar cellular-style
 * visualizer tiers (-50 dBm = 5 bars, -100 dBm = 1 bar) and provides distance
 * and quality classification according to the Log-Distance Path Loss Model.
 */

export type SignalTier = "excellent" | "good" | "fair" | "poor" | "weak" | "none";

export interface SignalTierDefinition {
  bars: number;
  tier: SignalTier;
  label: string;
  minRssi: number;
  maxRssi: number;
  colorClass: string;
  bgColorClass: string;
  borderColorClass: string;
}

/**
 * Standard RSSI threshold tiers for 5-bar cellular representation:
 * Tier 5: >= -60 dBm (Excellent, covers -50 dBm)
 * Tier 4: -70 to -61 dBm (Good)
 * Tier 3: -80 to -71 dBm (Fair)
 * Tier 2: -90 to -81 dBm (Poor)
 * Tier 1: -100 to -91 dBm (Weak, covers -100 dBm)
 * Tier 0: < -100 dBm or invalid (No signal / Out of range)
 */
export const SIGNAL_TIER_THRESHOLDS = {
  EXCELLENT_MIN: -60, // >= -60 dBm -> 5 bars (includes -50 dBm)
  GOOD_MIN: -70,      // >= -70 dBm -> 4 bars
  FAIR_MIN: -80,      // >= -80 dBm -> 3 bars
  POOR_MIN: -90,      // >= -90 dBm -> 2 bars
  WEAK_MIN: -100,     // >= -100 dBm -> 1 bar (includes -100 dBm)
} as const;

/**
 * Maps a numeric RSSI value (in dBm) cleanly to a 1–5 bar count.
 * Returns 0 if RSSI is null, undefined, non-finite, or below -100 dBm.
 *
 * Calibration anchors:
 * - -50 dBm = 5 bars (Tier 5: >= -60 dBm)
 * - -100 dBm = 1 bar (Tier 1: >= -100 dBm and < -90 dBm)
 *
 * @param rssi - Raw or smoothed RSSI in dBm
 * @param clampToMinBar - If true, non-null finite readings below -100 dBm clamp to 1 bar instead of 0
 * @returns An integer between 0 and 5 representing the number of active signal bars
 */
export function rssiToSignalBars(
  rssi: number | null | undefined,
  clampToMinBar: boolean = false
): number {
  if (rssi === null || rssi === undefined || !Number.isFinite(rssi)) {
    return 0;
  }

  if (rssi >= SIGNAL_TIER_THRESHOLDS.EXCELLENT_MIN) {
    return 5;
  }
  if (rssi >= SIGNAL_TIER_THRESHOLDS.GOOD_MIN) {
    return 4;
  }
  if (rssi >= SIGNAL_TIER_THRESHOLDS.FAIR_MIN) {
    return 3;
  }
  if (rssi >= SIGNAL_TIER_THRESHOLDS.POOR_MIN) {
    return 2;
  }
  if (rssi >= SIGNAL_TIER_THRESHOLDS.WEAK_MIN) {
    return 1;
  }

  return clampToMinBar ? 1 : 0;
}

/**
 * Returns the qualitative signal tier based on RSSI.
 */
export function getSignalTier(rssi: number | null | undefined): SignalTier {
  const bars = rssiToSignalBars(rssi);
  switch (bars) {
    case 5:
      return "excellent";
    case 4:
      return "good";
    case 3:
      return "fair";
    case 2:
      return "poor";
    case 1:
      return "weak";
    default:
      return "none";
  }
}

/**
 * Returns human-readable label for the signal quality tier.
 */
export function getSignalQualityLabel(rssi: number | null | undefined): string {
  const tier = getSignalTier(rssi);
  switch (tier) {
    case "excellent":
      return "Excellent";
    case "good":
      return "Good";
    case "fair":
      return "Fair";
    case "poor":
      return "Poor";
    case "weak":
      return "Weak";
    default:
      return "No Signal";
  }
}

/**
 * Returns color classes corresponding to the signal bar count.
 */
export function getSignalBarColors(bars: number): {
  barActive: string;
  barInactive: string;
  text: string;
  badgeBg: string;
  badgeBorder: string;
} {
  switch (bars) {
    case 5:
      return {
        barActive: "bg-emerald-400 text-emerald-400 fill-emerald-400",
        barInactive: "bg-zinc-800 text-zinc-800 fill-zinc-800",
        text: "text-emerald-400",
        badgeBg: "bg-emerald-500/10",
        badgeBorder: "border-emerald-500/20",
      };
    case 4:
      return {
        barActive: "bg-green-400 text-green-400 fill-green-400",
        barInactive: "bg-zinc-800 text-zinc-800 fill-zinc-800",
        text: "text-green-400",
        badgeBg: "bg-green-500/10",
        badgeBorder: "border-green-500/20",
      };
    case 3:
      return {
        barActive: "bg-amber-400 text-amber-400 fill-amber-400",
        barInactive: "bg-zinc-800 text-zinc-800 fill-zinc-800",
        text: "text-amber-400",
        badgeBg: "bg-amber-500/10",
        badgeBorder: "border-amber-500/20",
      };
    case 2:
      return {
        barActive: "bg-orange-400 text-orange-400 fill-orange-400",
        barInactive: "bg-zinc-800 text-zinc-800 fill-zinc-800",
        text: "text-orange-400",
        badgeBg: "bg-orange-500/10",
        badgeBorder: "border-orange-500/20",
      };
    case 1:
      return {
        barActive: "bg-rose-400 text-rose-400 fill-rose-400",
        barInactive: "bg-zinc-800 text-zinc-800 fill-zinc-800",
        text: "text-rose-400",
        badgeBg: "bg-rose-500/10",
        badgeBorder: "border-rose-500/20",
      };
    default:
      return {
        barActive: "bg-zinc-600 text-zinc-600 fill-zinc-600",
        barInactive: "bg-zinc-800 text-zinc-800 fill-zinc-800",
        text: "text-zinc-500",
        badgeBg: "bg-zinc-800/40",
        badgeBorder: "border-zinc-700/40",
      };
  }
}

/**
 * Calculates estimated distance in meters using Log-Distance Path Loss Model:
 * d = 10^((txPower - RSSI) / (10 * n))
 *
 * @param rssi - Measured RSSI in dBm
 * @param txPower - Reference RSSI at 1m (default -59 dBm)
 * @param pathLossExponent - Environmental path loss exponent (default 2.5 for open coworking)
 */
export function calculateRssiDistance(
  rssi: number | null | undefined,
  txPower: number = -59,
  pathLossExponent: number = 2.5
): number | null {
  if (rssi === null || rssi === undefined || !Number.isFinite(rssi)) {
    return null;
  }
  const exponent = (txPower - rssi) / (10 * pathLossExponent);
  const distance = Math.pow(10, exponent);
  return Math.max(0.1, Math.min(100.0, Number(distance.toFixed(2))));
}
