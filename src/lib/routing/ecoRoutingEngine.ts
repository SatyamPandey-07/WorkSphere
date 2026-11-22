import {
  calculateCarbonSavings,
  type CarbonSavingsBreakdown,
  type TransitMode,
} from '@/lib/analytics/carbonCalculator';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface EcoRouteOption {
  id: string;
  mode: TransitMode;
  distanceKm: number;
  elevationGainMeters: number;
  durationMinutes: number;
  effectiveMinutes: number;
  carbon: CarbonSavingsBreakdown;
  paretoOptimal: boolean;
  source: 'osrm' | 'haversine-fallback';
}

export interface EcoRoutingHooks {
  fetchOsrmLeg?: (
    origin: GeoPoint,
    destination: GeoPoint,
    mode: TransitMode,
    signal?: AbortSignal
  ) => Promise<{ distanceKm: number; durationMinutes: number } | null>;
  fetchElevationGainMeters?: (
    origin: GeoPoint,
    destination: GeoPoint,
    mode: TransitMode,
    signal?: AbortSignal
  ) => Promise<number | null>;
}

export function haversineDistanceKm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * 6371 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function estimateElevationPenaltyMinutes(
  mode: TransitMode,
  elevationGainMeters: number
): number {
  const gain = Math.max(0, elevationGainMeters);
  if (mode === 'foot') return gain / 12;
  if (mode === 'bike') return gain / 18;
  return gain / 60;
}

export function getBaseSpeedKmh(mode: TransitMode): number {
  if (mode === 'foot') return 4.8;
  if (mode === 'bike') return 15;
  return 22;
}

export function computeParetoFrontier(
  options: Omit<EcoRouteOption, 'paretoOptimal'>[]
): EcoRouteOption[] {
  return options.map((candidate) => {
    const dominated = options.some(
      (other) =>
        other.id !== candidate.id &&
        other.effectiveMinutes <= candidate.effectiveMinutes &&
        other.carbon.modeEmissionsKg <= candidate.carbon.modeEmissionsKg &&
        (other.effectiveMinutes < candidate.effectiveMinutes ||
          other.carbon.modeEmissionsKg < candidate.carbon.modeEmissionsKg)
    );

    return {
      ...candidate,
      paretoOptimal: !dominated,
    };
  });
}

export async function buildEcoRouteOptions(
  origin: GeoPoint,
  destination: GeoPoint,
  hooks: EcoRoutingHooks = {},
  signal?: AbortSignal
): Promise<EcoRouteOption[]> {
  const modes: TransitMode[] = ['foot', 'bike', 'transit'];
  const fallbackKm = haversineDistanceKm(origin, destination);

  const rawOptions = await Promise.all(
    modes.map(async (mode) => {
      let distanceKm = fallbackKm;
      let durationMinutes =
        fallbackKm > 0 ? (fallbackKm / getBaseSpeedKmh(mode)) * 60 : 0;
      let source: 'osrm' | 'haversine-fallback' = 'haversine-fallback';

      if (hooks.fetchOsrmLeg) {
        try {
          const osrm = await hooks.fetchOsrmLeg(
            origin,
            destination,
            mode,
            signal
          );
          if (
            osrm &&
            Number.isFinite(osrm.distanceKm) &&
            osrm.distanceKm >= 0 &&
            Number.isFinite(osrm.durationMinutes) &&
            osrm.durationMinutes >= 0
          ) {
            distanceKm = osrm.distanceKm;
            durationMinutes = osrm.durationMinutes;
            source = 'osrm';
          }
        } catch {
          source = 'haversine-fallback';
        }
      }

      let elevationGainMeters = 0;
      if (hooks.fetchElevationGainMeters) {
        try {
          const gain = await hooks.fetchElevationGainMeters(
            origin,
            destination,
            mode,
            signal
          );
          if (typeof gain === 'number' && Number.isFinite(gain) && gain > 0) {
            elevationGainMeters = gain;
          }
        } catch {
          elevationGainMeters = 0;
        }
      }

      const penaltyMin = estimateElevationPenaltyMinutes(
        mode,
        elevationGainMeters
      );
      const effectiveMinutes = Number((durationMinutes + penaltyMin).toFixed(1));
      const carbon = calculateCarbonSavings({ distanceKm, mode });

      return {
        id: `route-${mode}`,
        mode,
        distanceKm: Number(distanceKm.toFixed(3)),
        elevationGainMeters: Math.round(elevationGainMeters),
        durationMinutes: Number(durationMinutes.toFixed(1)),
        effectiveMinutes,
        carbon,
        source,
      };
    })
  );

  return computeParetoFrontier(rawOptions);
}