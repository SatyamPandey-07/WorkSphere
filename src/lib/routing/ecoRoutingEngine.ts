import { calculateCarbonSavings, type TransitMode } from '@/lib/analytics/carbonCalculator';

export interface GeoPoint {
  lat: number;
  lng: number;
  label?: string;
}

export interface RouteLegMetrics {
  mode: Exclude<TransitMode, 'car_ice'>;
  distanceKm: number;
  durationMinutes: number;
  elevationGainMeters: number;
  waypoints: GeoPoint[];
}

export interface ParetoRouteAlternative {
  routeId: string;
  modes: Array<Exclude<TransitMode, 'car_ice'>>;
  durationMinutes: number;
  distanceKm: number;
  elevationGainMeters: number;
  carbonSavedGrams: number;
  paretoScore: number;
  waypoints: GeoPoint[];
}

export interface OsrmLegProvider {
  getLeg(
    origin: GeoPoint,
    destination: GeoPoint,
    mode: Exclude<TransitMode, 'car_ice'>
  ): Promise<RouteLegMetrics>;
}

export interface ElevationProvider {
  getElevationGainMeters(points: GeoPoint[]): Promise<number>;
}

export interface EcoRoutingOptions {
  osrmProvider?: OsrmLegProvider;
  elevationProvider?: ElevationProvider;
  maxLatencyMs?: number;
  elevationPenaltyWeight?: number;
}

function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function defaultLegEstimate(
  origin: GeoPoint,
  destination: GeoPoint,
  mode: Exclude<TransitMode, 'car_ice'>
): RouteLegMetrics {
  const straightKm = Math.max(0.2, haversineKm(origin, destination));
  const speedKmh: Record<Exclude<TransitMode, 'car_ice'>, number> = {
    foot: 4.8,
    bike: 14.5,
    metro: 30,
    rail: 28,
    bus: 18,
  };
  const circuity: Record<Exclude<TransitMode, 'car_ice'>, number> = {
    foot: 1.2,
    bike: 1.25,
    metro: 1.3,
    rail: 1.32,
    bus: 1.28,
  };

  const distanceKm = Math.round(straightKm * circuity[mode] * 1000) / 1000;
  const durationMinutes =
    Math.round(((distanceKm / speedKmh[mode]) * 60 + (mode === 'metro' || mode === 'rail' || mode === 'bus' ? 5 : 0)) * 10) / 10;

  const mid: GeoPoint = {
    lat: (origin.lat + destination.lat) / 2,
    lng: (origin.lng + destination.lng) / 2,
    label: `${mode.toUpperCase()}_VIA`,
  };

  return {
    mode,
    distanceKm,
    durationMinutes,
    elevationGainMeters: 0,
    waypoints: [origin, mid, destination],
  };
}

export function isParetoDominated(
  candidate: ParetoRouteAlternative,
  others: ParetoRouteAlternative[]
): boolean {
  return others.some((other) => {
    if (other.routeId === candidate.routeId) return false;
    const noWorse =
      other.durationMinutes <= candidate.durationMinutes &&
      other.elevationGainMeters <= candidate.elevationGainMeters &&
      other.carbonSavedGrams >= candidate.carbonSavedGrams;
    const strictlyBetter =
      other.durationMinutes < candidate.durationMinutes ||
      other.elevationGainMeters < candidate.elevationGainMeters ||
      other.carbonSavedGrams > candidate.carbonSavedGrams;
    return noWorse && strictlyBetter;
  });
}

export async function computeEcoParetoRoutes(
  origin: GeoPoint,
  destination: GeoPoint,
  options: EcoRoutingOptions = {}
): Promise<ParetoRouteAlternative[]> {
  const maxLatencyMs = options.maxLatencyMs ?? 400;
  const climbPenaltyFactor = options.elevationPenaltyWeight ?? 0.08;
  const startedAt = performance.now();

  const candidateModes: Array<Exclude<TransitMode, 'car_ice'>> = [
    'metro',
    'bike',
    'bus',
    'rail',
    'foot',
  ];

  const legs = await Promise.all(
    candidateModes.map(async (mode) => {
      const elapsed = performance.now() - startedAt;
      if (options.osrmProvider && elapsed < maxLatencyMs * 0.65) {
        try {
          return await options.osrmProvider.getLeg(origin, destination, mode);
        } catch {
          return defaultLegEstimate(origin, destination, mode);
        }
      }
      return defaultLegEstimate(origin, destination, mode);
    })
  );

  const enriched: ParetoRouteAlternative[] = [];
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    let climbMeters = leg.elevationGainMeters;
    const elapsed = performance.now() - startedAt;

    if (options.elevationProvider && elapsed < maxLatencyMs * 0.85) {
      try {
        climbMeters = await options.elevationProvider.getElevationGainMeters(leg.waypoints);
      } catch {
        climbMeters = leg.elevationGainMeters;
      }
    }

    const effectiveDuration =
      Math.round((leg.durationMinutes + climbMeters * climbPenaltyFactor) * 10) / 10;
    const carbon = calculateCarbonSavings({
      distanceKm: leg.distanceKm,
      mode: leg.mode,
    });

    const paretoScore =
      Math.round(
        (carbon.carbonSavedGrams - effectiveDuration * 8 - climbMeters * 0.5) * 100
      ) / 100;

    enriched.push({
      routeId: `eco-${leg.mode}-${i + 1}`,
      modes: [leg.mode],
      durationMinutes: effectiveDuration,
      distanceKm: leg.distanceKm,
      elevationGainMeters: Math.round(climbMeters * 10) / 10,
      carbonSavedGrams: carbon.carbonSavedGrams,
      paretoScore,
      waypoints: leg.waypoints,
    });
  }

  const nonDominated = enriched.filter((item) => !isParetoDominated(item, enriched));
  const pool = nonDominated.length >= 3 ? nonDominated : enriched;

  return [...pool]
    .sort((a, b) => b.paretoScore - a.paretoScore)
    .slice(0, 3);
}