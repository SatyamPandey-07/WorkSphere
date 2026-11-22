/**
 * ecoRoutingEngine.ts
 *
 * Resilient eco-routing engine with fallback to direct Haversine distance
 * and walking time estimation when external routing services (OSRM, Valhalla, etc.)
 * return 503, 504, network timeouts, or errors.
 */

import { haversineKm, isValidCoordinate } from '@/lib/distance';

export interface RouteCoordinates {
  lat: number;
  lng: number;
}

export type RoutingProfile = 'walking' | 'cycling' | 'driving';

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
 * Standard walking speed in km/h (4.8 km/h = ~1.333 m/s = 80 m/min).
 */
export const DEFAULT_WALKING_SPEED_KMH = 4.8;

/**
 * Validates coordinate pair.
 */
export function areValidCoordinates(
  coord?: RouteCoordinates | null
): coord is RouteCoordinates {
  if (!coord || typeof coord !== 'object') return false;
  return (
    typeof coord.lat === 'number' &&
    typeof coord.lng === 'number' &&
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
  profile: RoutingProfile = 'walking',
  walkingSpeedKmH: number = DEFAULT_WALKING_SPEED_KMH,
  fallbackReason: string = 'ROUTING_SERVICE_UNAVAILABLE'
): EcoRouteResult {
  const distanceKm = haversineKm(start.lat, start.lng, end.lat, end.lng);
  const distanceMeters = Math.round(distanceKm * 1000);

  // Speed in m/s = (km/h * 1000) / 3600 = km/h / 3.6
  // Duration in seconds = distanceMeters / (speedKmH / 3.6)
  const speedMps = (walkingSpeedKmH * 1000) / 3600;
  const durationSeconds = speedMps > 0 ? Math.round(distanceMeters / speedMps) : 0;

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
  options: EcoRoutingOptions = {}
): Promise<EcoRouteResult> {
  const {
    profile = 'walking',
    timeoutMs = 5000,
    baseUrl = process.env.NEXT_PUBLIC_OSRM_URL || 'https://router.project-osrm.org',
    walkingSpeedKmH = DEFAULT_WALKING_SPEED_KMH,
  } = options;

  // 1. Validate coordinates
  if (!areValidCoordinates(start) || !areValidCoordinates(end)) {
    throw new Error('Invalid or missing coordinates provided for eco-route calculation.');
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

  const osrmProfile = profile === 'walking' ? 'foot' : profile === 'cycling' ? 'bicycle' : 'car';
  const url = `${baseUrl}/route/v1/${osrmProfile}/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`;

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const reason =
        response.status === 503
          ? 'SERVICE_UNAVAILABLE_503'
          : response.status === 504
          ? 'GATEWAY_TIMEOUT_504'
          : `HTTP_ERROR_${response.status}`;

      console.warn(
        `[ecoRoutingEngine] Routing provider returned status ${response.status}. Falling back to Haversine direct estimate.`,
        { status: response.status, url: baseUrl }
      );

      return calculateDirectHaversineFallback(
        start,
        end,
        profile,
        walkingSpeedKmH,
        reason
      );
    }

    const data = await response.json();

    if (!data || !Array.isArray(data.routes) || data.routes.length === 0) {
      console.warn(
        '[ecoRoutingEngine] Routing provider returned no routes. Falling back to Haversine estimate.'
      );
      return calculateDirectHaversineFallback(
        start,
        end,
        profile,
        walkingSpeedKmH,
        'NO_ROUTES_RETURNED'
      );
    }

    const primaryRoute = data.routes[0];
    const coordinates = primaryRoute.geometry?.coordinates || [];
    const path = coordinates.map((coord: [number, number]) => ({
      lat: coord[1],
      lng: coord[0],
    }));

    return {
      path: path.length > 0 ? path : [{ lat: start.lat, lng: start.lng }, { lat: end.lat, lng: end.lng }],
      distanceMeters: Math.round(primaryRoute.distance ?? 0),
      durationSeconds: Math.round(primaryRoute.duration ?? 0),
      isEstimated: false,
      mode: profile,
    };
  } catch (error: any) {
    clearTimeout(timeoutId);

    const isTimeout = error?.name === 'AbortError' || error?.message?.includes('timeout');
    const fallbackReason = isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR';

    console.warn(
      `[ecoRoutingEngine] Routing provider failure (${fallbackReason}): ${error?.message || error}. Falling back to Haversine direct estimate.`
    );

    return calculateDirectHaversineFallback(
      start,
      end,
      profile,
      walkingSpeedKmH,
      fallbackReason
    );
  }
}
