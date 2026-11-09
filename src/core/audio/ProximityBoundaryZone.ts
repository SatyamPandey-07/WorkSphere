/**
 * ProximityBoundaryZone.ts
 *
 * Core engine for configurable audio proximity fade-out boundary zones.
 * Models multi-tiered spatial audio attenuation zones:
 * - Core Presence Zone (0 to innerRadius): 100% gain, full acoustic clarity
 * - Fade-Out Corridor (innerRadius to outerRadius): progressive acoustic attenuation along a configurable curve
 * - Boundary Cutoff Zone (> outerRadius): full attenuation down to minGainFloor (complete isolation or whisper)
 */

export type FadeOutCurve =
  | "linear"
  | "smoothstep"
  | "exponential"
  | "cosine"
  | "logarithmic";

export type ProximityZoneTier =
  | "core_presence"
  | "fade_corridor"
  | "boundary_cutoff";

export type ProximityZonePresetId =
  | "intimate_desk"
  | "team_pod"
  | "open_floor"
  | "broadcast"
  | "whisper_quiet"
  | "custom";

export interface ProximityBoundaryZoneConfig {
  /** Whether the proximity boundary zone calculation is active */
  enabled: boolean;
  /** Radius in meters within which audio is received at 100% gain (no attenuation) */
  innerRadius: number;
  /** Radius in meters at and beyond which audio fades out to minGainFloor */
  outerRadius: number;
  /** Mathematical curve used to attenuate audio in the transition corridor */
  fadeCurve: FadeOutCurve;
  /** Minimum gain floor at or beyond outerRadius (0.0 = complete silence/isolation) */
  minGainFloor: number;
  /** Preset identifier for pre-configured templates */
  presetId?: ProximityZonePresetId;
  /** Human-readable display label */
  label?: string;
  /** Optional custom rolloff steepness multiplier (default 1.0) */
  rolloffFactor?: number;
}

export const PROXIMITY_ZONE_PRESETS: Record<
  Exclude<ProximityZonePresetId, "custom">,
  ProximityBoundaryZoneConfig
> = {
  intimate_desk: {
    enabled: true,
    presetId: "intimate_desk",
    label: "Intimate Desk (1.5m - 4.0m)",
    innerRadius: 1.5,
    outerRadius: 4.0,
    fadeCurve: "smoothstep",
    minGainFloor: 0.0,
    rolloffFactor: 1.2,
  },
  team_pod: {
    enabled: true,
    presetId: "team_pod",
    label: "Team Pod (3.0m - 8.0m)",
    innerRadius: 3.0,
    outerRadius: 8.0,
    fadeCurve: "smoothstep",
    minGainFloor: 0.0,
    rolloffFactor: 1.0,
  },
  open_floor: {
    enabled: true,
    presetId: "open_floor",
    label: "Open Floor (5.0m - 16.0m)",
    innerRadius: 5.0,
    outerRadius: 16.0,
    fadeCurve: "exponential",
    minGainFloor: 0.0,
    rolloffFactor: 1.0,
  },
  broadcast: {
    enabled: true,
    presetId: "broadcast",
    label: "Broadcast Hall (10.0m - 30.0m)",
    innerRadius: 10.0,
    outerRadius: 30.0,
    fadeCurve: "linear",
    minGainFloor: 0.05,
    rolloffFactor: 0.8,
  },
  whisper_quiet: {
    enabled: true,
    presetId: "whisper_quiet",
    label: "Whisper Isolation (1.0m - 2.5m)",
    innerRadius: 1.0,
    outerRadius: 2.5,
    fadeCurve: "cosine",
    minGainFloor: 0.0,
    rolloffFactor: 1.5,
  },
};

export const DEFAULT_PROXIMITY_ZONE_CONFIG: ProximityBoundaryZoneConfig = {
  enabled: true,
  presetId: "team_pod",
  label: "Team Pod (3.0m - 8.0m)",
  innerRadius: 3.0,
  outerRadius: 8.0,
  fadeCurve: "smoothstep",
  minGainFloor: 0.0,
  rolloffFactor: 1.0,
};

/**
 * Calculates Euclidean 3D distance between two points.
 */
export function calculate3DDistance(
  p1: { x: number; y: number; z?: number },
  p2: { x: number; y: number; z?: number }
): number {
  const dx = (p1.x ?? 0) - (p2.x ?? 0);
  const dy = (p1.y ?? 0) - (p2.y ?? 0);
  const dz = (p1.z ?? 0) - (p2.z ?? 0);
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return Number.isNaN(d) || !Number.isFinite(d) ? 0 : Math.max(0, d);
}

/**
 * Classifies a distance into one of three proximity boundary zone tiers.
 */
export function getProximityZoneTier(
  distance: number,
  config: ProximityBoundaryZoneConfig = DEFAULT_PROXIMITY_ZONE_CONFIG
): ProximityZoneTier {
  const safeDist = Math.max(0, distance);
  if (safeDist <= config.innerRadius) {
    return "core_presence";
  }
  if (safeDist >= config.outerRadius) {
    return "boundary_cutoff";
  }
  return "fade_corridor";
}

/**
 * Computes the normalized attenuation gain factor [0.0, 1.0] for a given distance
 * and proximity boundary zone configuration.
 *
 * Guarantees:
 * - Distance <= innerRadius: exactly 1.0
 * - Distance >= outerRadius: exactly minGainFloor (clamped [0.0, 1.0])
 * - innerRadius < Distance < outerRadius: smooth acoustic transition along specified fadeCurve
 * - NaN / non-finite inputs return safe fallback (0.0 or 1.0)
 */
export function calculateProximityFadeGain(
  distance: number,
  config: ProximityBoundaryZoneConfig = DEFAULT_PROXIMITY_ZONE_CONFIG
): number {
  if (!config.enabled) {
    return 1.0;
  }

  if (Number.isNaN(distance) || !Number.isFinite(distance) || distance < 0) {
    return 1.0;
  }

  const inner = Math.max(0, config.innerRadius);
  const outer = Math.max(inner + 1e-4, config.outerRadius);
  const floor = Math.max(0.0, Math.min(1.0, config.minGainFloor ?? 0.0));

  // 1. Core presence zone: full volume
  if (distance <= inner) {
    return 1.0;
  }

  // 2. Beyond outer boundary: cutoff to minimum gain floor
  if (distance >= outer) {
    return floor;
  }

  // 3. Fade-out corridor: compute normalized progress t in [0.0, 1.0]
  const rawT = (distance - inner) / (outer - inner);
  const t = Math.max(0.0, Math.min(1.0, rawT));
  const rolloff = Math.max(0.1, config.rolloffFactor ?? 1.0);

  let normalizedGain: number;

  switch (config.fadeCurve) {
    case "linear": {
      normalizedGain = 1.0 - t * rolloff;
      break;
    }
    case "smoothstep": {
      // Hermite polynomial interpolation: 3t^2 - 2t^3
      const smoothT = t * t * (3.0 - 2.0 * t);
      normalizedGain = 1.0 - smoothT * rolloff;
      break;
    }
    case "exponential": {
      // Quadratic decay representing acoustic energy falloff
      const decay = Math.pow(1.0 - t, 2.0 * rolloff);
      normalizedGain = decay;
      break;
    }
    case "cosine": {
      // Half-cosine smooth fade: 0.5 * (1 + cos(pi * t))
      normalizedGain = 0.5 * (1.0 + Math.cos(Math.PI * Math.min(1.0, t * rolloff)));
      break;
    }
    case "logarithmic": {
      // Perceptually uniform decibel decay (-36 dB scale)
      const dbFloor = -36.0;
      const db = dbFloor * Math.min(1.0, t * rolloff);
      normalizedGain = Math.pow(10.0, db / 20.0);
      break;
    }
    default: {
      normalizedGain = 1.0 - t;
      break;
    }
  }

  const clampedNormalized = Math.max(0.0, Math.min(1.0, normalizedGain));

  // Blend between 1.0 and minGainFloor
  const finalGain = floor + clampedNormalized * (1.0 - floor);

  if (Number.isNaN(finalGain) || !Number.isFinite(finalGain)) {
    return floor;
  }

  return Math.max(0.0, Math.min(1.0, finalGain));
}

/**
 * Validates and sanitizes a partial ProximityBoundaryZoneConfig object.
 */
export function sanitizeProximityZoneConfig(
  partial?: Partial<ProximityBoundaryZoneConfig>
): ProximityBoundaryZoneConfig {
  const base = DEFAULT_PROXIMITY_ZONE_CONFIG;
  if (!partial) return { ...base };

  const inner = Math.max(0.1, partial.innerRadius ?? base.innerRadius);
  const outer = Math.max(inner + 0.5, partial.outerRadius ?? base.outerRadius);
  const floor = Math.max(0.0, Math.min(1.0, partial.minGainFloor ?? base.minGainFloor));

  return {
    enabled: partial.enabled ?? base.enabled,
    innerRadius: Number(inner.toFixed(2)),
    outerRadius: Number(outer.toFixed(2)),
    fadeCurve: partial.fadeCurve ?? base.fadeCurve,
    minGainFloor: Number(floor.toFixed(3)),
    rolloffFactor: Math.max(0.1, Math.min(5.0, partial.rolloffFactor ?? base.rolloffFactor ?? 1.0)),
    presetId: partial.presetId ?? "custom",
    label: partial.label ?? `Custom (${inner}m - ${outer}m)`,
  };
}
