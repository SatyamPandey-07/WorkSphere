/**
 * ecoRoutingEngine.ts
 *
 * Issue #9613: feat(routing): add elevation gain and calorie expenditure to eco-commute route cards
 *
 * Core engine for eco-commute routing:
 * 1. Calculates cumulative elevation changes (net climb meters) from elevation profiles,
 *    correctly distinguishing flat terrain (0m) from mountainous profiles, and ignoring descents.
 * 2. Estimates active calorie expenditure for green nomad mobility (walking, cycling, micro-mobility)
 *    using Metabolic Equivalent of Task (MET) values, distance, and standard adult body mass constants.
 * 3. Constructs accessible elevation badges, calorie chips, and multi-modal route recommendation cards
 *    with compliant screen-reader aria labels.
 */

import {
  calculateElevationGain as calcElevationGain,
  calculateActiveCalories as calcActiveCalories,
  extractElevationValues,
  formatElevation,
  formatCalories,
  normalizeTransportationMode,
  DEFAULT_BODY_WEIGHT_KG,
  WALKING_MET,
  CYCLING_MET,
  METERS_TO_FEET,
  type ElevationPoint,
  type ElevationProfile,
} from "./elevationCalculator";

export {
  DEFAULT_BODY_WEIGHT_KG,
  WALKING_MET,
  CYCLING_MET,
  METERS_TO_FEET,
  extractElevationValues,
  formatElevation,
  formatCalories,
  normalizeTransportationMode,
};

export type { ElevationPoint, ElevationProfile };

export type EcoCommuteMode =
  "walking" | "cycling" | "micro-mobility" | "transit" | "driving";

export interface EcoCalorieOptions {
  mode: EcoCommuteMode | string;
  durationMinutes?: number | null;
  durationSeconds?: number | null;
  distanceMeters?: number | null;
  elevationGainMeters?: number | null;
  weightKg?: number | null;
  includeGradientAdjustment?: boolean;
}

export interface ElevationBadge {
  netClimbMeters: number | null;
  displayValue: string;
  icon: "mountain" | "trending-up" | "flat";
  elevationProfileIcon: "mountain" | "trending-up" | "flat";
  ariaLabel: string;
}

export interface CalorieChip {
  calories: number | null;
  displayValue: string;
  icon: "flame";
  ariaLabel: string;
}

export interface EcoRouteRecommendationCard {
  id: string;
  mode: EcoCommuteMode;
  title: string;
  distanceMeters: number;
  durationSeconds: number;
  cost: number;
  elevationBadge: ElevationBadge;
  calorieChip: CalorieChip;
  isEcoFriendly: boolean;
}

/**
 * Calculates cumulative positive elevation gain (net climb meters) from an elevation profile.
 * - Sums only positive vertical climbing between sequential points.
 * - Ignores downhill sections (descents).
 * - Returns 0 for flat profiles with multiple sample points.
 * - Returns null for missing, empty, or single-point profiles to avoid fabricating 0m climb.
 */
export function calculateCumulativeElevationGain(
  profile?: ElevationProfile | null,
): number | null {
  return calcElevationGain(profile);
}

/**
 * Calculates active calorie expenditure for eco-commute modes.
 * - Accurately calculates calories based on distance, duration, and standard body mass (70kg).
 * - If duration is not provided, estimates duration from distance using standard velocities:
 *   Walking: ~4.8 km/h (80 m/min)
 *   Cycling: ~16 km/h (266.67 m/min)
 * - Walking uses MET = 3.5 (Active MET = 2.5) with ACSM speed & gradient adjustment when valid.
 * - Cycling and micro-mobility use MET = 6.8 (Active MET = 5.8).
 * - Driving and passive transit return null.
 * - Defaults body weight to DEFAULT_BODY_WEIGHT_KG (70 kg).
 */
export function calculateEcoCalories(
  options: EcoCalorieOptions,
): number | null {
  const { mode, durationMinutes, durationSeconds, distanceMeters, ...rest } =
    options;
  const rawMode = (mode || "").toLowerCase().trim();

  // Normalize micro-mobility to cycling for metabolic calculation (comparable e-bike/scooter effort)
  const calcMode = rawMode === "micro-mobility" ? "cycling" : rawMode;

  if (rawMode === "transit" || rawMode === "driving") {
    return null;
  }

  let resolvedMinutes = durationMinutes;
  if (resolvedMinutes === undefined || resolvedMinutes === null) {
    if (
      typeof durationSeconds === "number" &&
      Number.isFinite(durationSeconds)
    ) {
      resolvedMinutes = durationSeconds / 60;
    } else if (
      typeof distanceMeters === "number" &&
      Number.isFinite(distanceMeters) &&
      distanceMeters > 0
    ) {
      // Standard commuting velocities: Walking ~4.8 km/h (80 m/min), Cycling ~16 km/h (266.67 m/min)
      const speedMetersPerMinute = calcMode === "cycling" ? 266.67 : 80;
      resolvedMinutes = distanceMeters / speedMetersPerMinute;
    }
  }

  return calcActiveCalories({
    mode: calcMode as any,
    durationMinutes: resolvedMinutes,
    distanceMeters,
    ...rest,
  });
}

/**
 * Generates an accessible elevation gain badge.
 */
export function createElevationBadge(
  elevationGainMeters: number | null,
  unitPreference: "metric" | "imperial" = "metric",
): ElevationBadge {
  if (elevationGainMeters === null || !Number.isFinite(elevationGainMeters)) {
    return {
      netClimbMeters: null,
      displayValue: "N/A",
      icon: "mountain",
      elevationProfileIcon: "mountain",
      ariaLabel: "Elevation telemetry unavailable",
    };
  }

  const roundedMeters = Math.round(elevationGainMeters * 10) / 10;
  const displayValue = formatElevation(roundedMeters, unitPreference);

  if (roundedMeters === 0) {
    return {
      netClimbMeters: 0,
      displayValue,
      icon: "flat",
      elevationProfileIcon: "flat",
      ariaLabel: "Flat terrain with 0 meters elevation gain",
    };
  }

  const unitText = unitPreference === "imperial" ? "feet" : "meters";
  const convertedVal =
    unitPreference === "imperial"
      ? Math.round(roundedMeters * METERS_TO_FEET)
      : Math.round(roundedMeters);

  return {
    netClimbMeters: roundedMeters,
    displayValue,
    icon: "mountain",
    elevationProfileIcon: "mountain",
    ariaLabel: `Elevation gain: ${convertedVal} ${unitText} net uphill climb`,
  };
}

/**
 * Generates an accessible calorie burn chip.
 */
export function createCalorieChip(calories: number | null): CalorieChip {
  if (calories === null || !Number.isFinite(calories)) {
    return {
      calories: null,
      displayValue: "N/A",
      icon: "flame",
      ariaLabel: "Calorie expenditure not applicable for this transit mode",
    };
  }

  const rounded = Math.round(calories);
  return {
    calories: rounded,
    displayValue: formatCalories(rounded),
    icon: "flame",
    ariaLabel: `Estimated ${rounded} active calories burned`,
  };
}

export interface BuildRecommendationCardParams {
  id: string;
  mode: EcoCommuteMode;
  title: string;
  distanceMeters: number;
  durationSeconds: number;
  cost?: number;
  elevationProfile?: ElevationProfile | null;
  elevationGainMeters?: number | null;
  weightKg?: number | null;
  unitPreference?: "metric" | "imperial";
}

/**
 * Builds a single accessible multi-modal route recommendation card.
 */
export function buildEcoRouteRecommendationCard(
  params: BuildRecommendationCardParams,
): EcoRouteRecommendationCard {
  const {
    id,
    mode,
    title,
    distanceMeters,
    durationSeconds,
    cost = 0,
    elevationProfile,
    elevationGainMeters,
    weightKg = DEFAULT_BODY_WEIGHT_KG,
    unitPreference = "metric",
  } = params;

  // Resolve elevation gain
  let resolvedGain: number | null = null;
  if (
    typeof elevationGainMeters === "number" &&
    Number.isFinite(elevationGainMeters)
  ) {
    resolvedGain = elevationGainMeters;
  } else if (elevationProfile) {
    resolvedGain = calculateCumulativeElevationGain(elevationProfile);
  }

  const elevationBadge = createElevationBadge(resolvedGain, unitPreference);

  // Resolve active calories
  const calories = calculateEcoCalories({
    mode,
    durationSeconds,
    distanceMeters,
    elevationGainMeters: resolvedGain,
    weightKg,
    includeGradientAdjustment: true,
  });

  const calorieChip = createCalorieChip(calories);

  const isEcoFriendly =
    mode === "walking" || mode === "cycling" || mode === "micro-mobility";

  return {
    id,
    mode,
    title,
    distanceMeters,
    durationSeconds,
    cost,
    elevationBadge,
    calorieChip,
    isEcoFriendly,
  };
}

export interface GenerateMultiModalRouteCardsOptions {
  walkingDistanceMeters?: number;
  walkingDurationSeconds?: number;
  hasMicroMobility?: boolean;
  microMobilityVehicleCount?: number;
  microMobilityDistanceMeters?: number;
  microMobilityDurationSeconds?: number;
  microMobilityCost?: number;
  elevationProfile?: ElevationProfile | null;
  elevationGainMeters?: number | null;
  weightKg?: number | null;
  unitPreference?: "metric" | "imperial";
}

/**
 * Constructs multi-modal route recommendation cards for eco-friendly nomad commuting.
 */
export function generateMultiModalRouteCards(
  options: GenerateMultiModalRouteCardsOptions = {},
): EcoRouteRecommendationCard[] {
  const {
    walkingDistanceMeters = 1200,
    walkingDurationSeconds = 900,
    hasMicroMobility = false,
    microMobilityDistanceMeters = 1500,
    microMobilityDurationSeconds = 360,
    microMobilityCost = 2.5,
    elevationProfile,
    elevationGainMeters,
    weightKg,
    unitPreference,
  } = options;

  const cards: EcoRouteRecommendationCard[] = [];

  // 1. Eco Walk Card
  cards.push(
    buildEcoRouteRecommendationCard({
      id: "card-eco-walk",
      mode: "walking",
      title: "Eco Walk",
      distanceMeters: walkingDistanceMeters,
      durationSeconds: walkingDurationSeconds,
      cost: 0,
      elevationProfile,
      elevationGainMeters,
      weightKg,
      unitPreference,
    }),
  );

  // 2. Micro-Mobility / Cycling Card (if vehicles available or requested)
  if (hasMicroMobility) {
    cards.push(
      buildEcoRouteRecommendationCard({
        id: "card-micro-mobility",
        mode: "micro-mobility",
        title: "Micro-Mobility (E-Bike / Scooter)",
        distanceMeters: microMobilityDistanceMeters,
        durationSeconds: microMobilityDurationSeconds,
        cost: microMobilityCost,
        elevationProfile,
        elevationGainMeters,
        weightKg,
        unitPreference,
      }),
    );
  }

  return cards;
}
