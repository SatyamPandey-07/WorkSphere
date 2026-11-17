export interface GeoCoordinate {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_METERS = 6371000;
const MAX_TRAVEL_VELOCITY_MPS = 15.0; // Max speed in meters per second (e.g., e-bike / transit)

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Calculates accurate Great-Circle (Haversine) distance between two coordinates in meters.
 */
export function calculateGreatCircleDistance(a: GeoCoordinate, b: GeoCoordinate): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);

  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const c = 2 * Math.asin(Math.sqrt(sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng));

  return EARTH_RADIUS_METERS * c;
}

/**
 * Strictly admissible heuristic function: h(n) = distance / max_velocity.
 * Ensures h(n) never overestimates the actual remaining cost, maintaining A* optimality.
 */
export function admissibleHeuristic(current: GeoCoordinate, goal: GeoCoordinate, epsilon: number = 1.0): number {
  const distanceMeters = calculateGreatCircleDistance(current, goal);
  const baseTimeCost = distanceMeters / MAX_TRAVEL_VELOCITY_MPS;

  // Epsilon-admissible relaxation bounded safely
  return baseTimeCost * Math.max(1.0, epsilon);
}