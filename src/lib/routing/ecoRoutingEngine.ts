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

/**
 * Resilient eco-routing engine with fallback to direct Haversine distance
 * and walking time estimation when external routing services (OSRM, Valhalla, etc.)
 * return 503, 504, network timeouts, or errors.
 *
 * Also provides dynamic walking-distance isochrone polygon generation for
 * 5, 10, and 15-minute presets.
 */

import { haversineKm, isValidCoordinate } from "@/lib/distance";

export interface RouteCoordinates {
  lat: number;
  lng: number;
}

export type RoutingProfile = "walking" | "cycling" | "driving";

export interface EcoRoutingOptions {
  profile?: RoutingProfile;
  timeoutMs?: number;
  baseUrl?: string;
  walkingSpeedKmH?: number; // Defaults to 4.8 km/h
}

export interface EcoRouteResult {
  path: Array<{ lat: number; lng: number }>;
  distanceMeters: number;
  durationSeconds: number;
  isEstimated: boolean;
  fallbackReason?: string;
  mode: RoutingProfile;
}

/**
 * Standard walking speed in km/h for routing engine fallback (4.8 km/h = ~1.333 m/s = 80 m/min).
 */
export const DEFAULT_WALKING_SPEED_KMH = 4.8;

/**
 * Pedestrian walking speed for isochrone calculations: 5 km/h.
 */
export const ISOCHRONE_WALKING_SPEED_KMH = 5.0;

/**
 * Travel-time presets supported by the isochrone generator (in minutes).
 */
export type IsochronePresetMinutes = 5 | 10 | 15;
export const ISOCHRONE_PRESETS: readonly IsochronePresetMinutes[] = [
  5, 10, 15,
] as const;

export interface IsochroneOptions {
  walkingSpeedKmH?: number; // Defaults to 5.0 km/h
  steps?: number; // Number of points defining the polygon boundary (default 36 for smooth circle)
}

export interface IsochronePolygon {
  minutes: number;
  walkingSpeedKmH: number;
  radiusMeters: number;
  coordinates: Array<{ lat: number; lng: number }>;
  geoJson: {
    type: "Feature";
    geometry: {
      type: "Polygon";
      coordinates: number[][][]; // GeoJSON format: [[[lng, lat], ...]]
    };
    properties: {
      minutes: number;
      radiusMeters: number;
      walkingSpeedKmH: number;
    };
  };
  svgPath?: string;
}

/**
 * Validates coordinate pair.
 */
export function areValidCoordinates(
  coord?: RouteCoordinates | null,
): coord is RouteCoordinates {
  if (!coord || typeof coord !== "object") return false;
  return (
    typeof coord.lat === "number" &&
    typeof coord.lng === "number" &&
    isValidCoordinate(coord.lat, coord.lng)
  );
}

/**
 * Calculates direct straight-line distance via Haversine formula and
 * derives estimated duration based on walking speed.
 */
export function calculateDirectHaversineFallback(
  start: RouteCoordinates,
  end: RouteCoordinates,
  profile: RoutingProfile = "walking",
  walkingSpeedKmH: number = DEFAULT_WALKING_SPEED_KMH,
  fallbackReason: string = "ROUTING_SERVICE_UNAVAILABLE",
): EcoRouteResult {
  const distanceKm = haversineKm(start.lat, start.lng, end.lat, end.lng);
  const distanceMeters = Math.round(distanceKm * 1000);

  // Speed in m/s = (km/h * 1000) / 3600 = km/h / 3.6
  // Duration in seconds = distanceMeters / (speedKmH / 3.6)
  const speedMps = (walkingSpeedKmH * 1000) / 3600;
  const durationSeconds =
    speedMps > 0 ? Math.round(distanceMeters / speedMps) : 0;

  return {
    path: [
      { lat: start.lat, lng: start.lng },
      { lat: end.lat, lng: end.lng },
    ],
    distanceMeters,
    durationSeconds,
    isEstimated: true,
    fallbackReason,
    mode: profile,
  };
}

/**
 * Calculates route between two points using external routing provider (OSRM/Valhalla API),
 * with resilient fallback to straight-line Haversine distance and walking time estimation
 * if the service returns 503, 504, timeout, or network failures.
 */
export async function calculateEcoRoute(
  start: RouteCoordinates,
  end: RouteCoordinates,
  options: EcoRoutingOptions = {},
): Promise<EcoRouteResult> {
  const {
    profile = "walking",
    timeoutMs = 5000,
    baseUrl = process.env.NEXT_PUBLIC_OSRM_URL ||
      "https://router.project-osrm.org",
    walkingSpeedKmH = DEFAULT_WALKING_SPEED_KMH,
  } = options;

  // 1. Validate coordinates
  if (!areValidCoordinates(start) || !areValidCoordinates(end)) {
    throw new Error(
      "Invalid or missing coordinates provided for eco-route calculation.",
    );
  }

  // 2. Trivial case: start equals destination
  if (start.lat === end.lat && start.lng === end.lng) {
    return {
      path: [{ lat: start.lat, lng: start.lng }],
      distanceMeters: 0,
      durationSeconds: 0,
      isEstimated: false,
      mode: profile,
    };
  }

  // 3. Attempt external routing service with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const osrmProfile =
    profile === "walking" ? "foot" : profile === "cycling" ? "bicycle" : "car";
  const url = `${baseUrl}/route/v1/${osrmProfile}/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`;

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const reason =
        response.status === 503
          ? "SERVICE_UNAVAILABLE_503"
          : response.status === 504
            ? "GATEWAY_TIMEOUT_504"
            : `HTTP_ERROR_${response.status}`;

      console.warn(
        `[ecoRoutingEngine] Routing provider returned status ${response.status}. Falling back to Haversine direct estimate.`,
        { status: response.status, url: baseUrl },
      );

      return calculateDirectHaversineFallback(
        start,
        end,
        profile,
        walkingSpeedKmH,
        reason,
      );
    }

    const data = await response.json();

    if (!data || !Array.isArray(data.routes) || data.routes.length === 0) {
      console.warn(
        "[ecoRoutingEngine] Routing provider returned no routes. Falling back to Haversine estimate.",
      );
      return calculateDirectHaversineFallback(
        start,
        end,
        profile,
        walkingSpeedKmH,
        "NO_ROUTES_RETURNED",
      );
    }

    const primaryRoute = data.routes[0];
    const coordinates = primaryRoute.geometry?.coordinates || [];
    const path = coordinates.map((coord: [number, number]) => ({
      lat: coord[1],
      lng: coord[0],
    }));

    return {
      path:
        path.length > 0
          ? path
          : [
              { lat: start.lat, lng: start.lng },
              { lat: end.lat, lng: end.lng },
            ],
      distanceMeters: Math.round(primaryRoute.distance ?? 0),
      durationSeconds: Math.round(primaryRoute.duration ?? 0),
      isEstimated: false,
      mode: profile,
    };
  } catch (error: any) {
    clearTimeout(timeoutId);

    const isTimeout =
      error?.name === "AbortError" || error?.message?.includes("timeout");
    const fallbackReason = isTimeout ? "TIMEOUT" : "NETWORK_ERROR";

    console.warn(
      `[ecoRoutingEngine] Routing provider failure (${fallbackReason}): ${error?.message || error}. Falling back to Haversine direct estimate.`,
    );

    return calculateDirectHaversineFallback(
      start,
      end,
      profile,
      walkingSpeedKmH,
      fallbackReason,
    );
  }
}

/**
 * Generates an isochrone polygon representing the reachable area for a given walking time.
 *
 * Uses:
 * distance = walkingSpeed * (minutes / 60)
 *
 * Radius calculation converts spherical distance into lat/lng polygon vertices around the origin.
 *
 * @param origin Center point { lat, lng }
 * @param minutes Travel-time preset in minutes (e.g. 5, 10, 15)
 * @param options Walking speed and steps configuration
 * @returns IsochronePolygon or null if coordinates/minutes are invalid
 */
export function generateWalkingIsochrone(
  origin: RouteCoordinates | null | undefined,
  minutes: number,
  options: IsochroneOptions = {},
): IsochronePolygon | null {
  if (!areValidCoordinates(origin)) {
    return null;
  }

  if (
    typeof minutes !== "number" ||
    !Number.isFinite(minutes) ||
    minutes <= 0
  ) {
    return null;
  }

  const { walkingSpeedKmH = ISOCHRONE_WALKING_SPEED_KMH, steps = 36 } = options;

  if (
    typeof walkingSpeedKmH !== "number" ||
    !Number.isFinite(walkingSpeedKmH) ||
    walkingSpeedKmH <= 0
  ) {
    return null;
  }

  // Reachable radius: distance = speed * time
  const radiusKm = walkingSpeedKmH * (minutes / 60);
  const radiusMeters = Math.round(radiusKm * 1000);

  const numSteps = Math.max(12, steps);
  const coordinates: Array<{ lat: number; lng: number }> = [];
  const earthRadiusKm = 6371;

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;

  const latRad = toRad(origin.lat);
  const lngRad = toRad(origin.lng);
  const angularDistance = radiusKm / earthRadiusKm;

  // Generate smooth polygon vertices along bearing angles from 0 to 360
  for (let i = 0; i <= numSteps; i++) {
    const bearing = (2 * Math.PI * i) / numSteps;

    const pointLatRad = Math.asin(
      Math.sin(latRad) * Math.cos(angularDistance) +
        Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearing),
    );

    const pointLngRad =
      lngRad +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latRad),
        Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(pointLatRad),
      );

    const pointLat = Number(toDeg(pointLatRad).toFixed(6));
    // Normalize longitude between -180 and 180
    let pointLng = toDeg(pointLngRad);
    pointLng = ((((pointLng + 180) % 360) + 360) % 360) - 180;
    pointLng = Number(pointLng.toFixed(6));

    coordinates.push({ lat: pointLat, lng: pointLng });
  }

  // GeoJSON polygon coordinates ring: [lng, lat] with closed loop
  const geoJsonCoordinates = coordinates.map((pt) => [pt.lng, pt.lat]);

  return {
    minutes,
    walkingSpeedKmH,
    radiusMeters,
    coordinates,
    geoJson: {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [geoJsonCoordinates],
      },
      properties: {
        minutes,
        radiusMeters,
        walkingSpeedKmH,
      },
    },
  };
}
