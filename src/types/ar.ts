export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export function isFiniteVector3(value: unknown): value is Vector3 {
  if (typeof value !== "object" || value === null) return false;

  const vector = value as Partial<Vector3>;
  return (
    Number.isFinite(vector.x) &&
    Number.isFinite(vector.y) &&
    Number.isFinite(vector.z)
  );
}

export interface DeskAnchor {
  id: string;
  deskNumber: string;
  position: Vector3;
  floor: number;
}

export interface SpatialDistanceMetrics {
  distance3D: number;
  horizontalDistance: number;
  elevationDelta: number;
}

/**
 * Calculates 3D Euclidean distance, 2D horizontal distance, and vertical elevation delta between two spatial 3D points.
 */
export function calculate3DDistance(
  userPos: Vector3,
  targetPos: Vector3
): SpatialDistanceMetrics {
  const dx = targetPos.x - userPos.x;
  const dy = targetPos.y - userPos.y;
  const dz = targetPos.z - userPos.z;

  const distance3D = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const horizontalDistance = Math.sqrt(dx * dx + dz * dz);
  const elevationDelta = dy;

  return {
    distance3D,
    horizontalDistance,
    elevationDelta,
  };
}

/**
 * Applies low-pass Exponential Moving Average (EMA) smoothing to distance metrics to prevent visual jitter.
 * Formula: S_k = alpha * X_k + (1 - alpha) * S_{k-1}
 */
export function applyDistanceSmoothing(
  rawDistance: number,
  prevDistance: number | null,
  alpha: number = 0.2
): number {
  if (!Number.isFinite(rawDistance)) return 0;
  if (prevDistance === null || !Number.isFinite(prevDistance)) {
    return Math.round(rawDistance * 10) / 10;
  }
  const safeAlpha = Math.max(0.01, Math.min(1.0, alpha));
  const smoothed = safeAlpha * rawDistance + (1 - safeAlpha) * prevDistance;
  return Math.round(smoothed * 10) / 10;
}

/**
 * Formats floor and elevation indicator string (e.g., "Floor 2 (+4.2m)", "Floor 1 (-3.0m)", or "Same Level (+0.2m)").
 */
export function formatElevationIndicator(
  elevationDelta: number,
  floorLevel?: number
): string {
  const roundedDelta = Math.round(elevationDelta * 10) / 10;
  const sign = roundedDelta >= 0 ? "+" : "";

  if (floorLevel !== undefined) {
    return `Floor ${floorLevel} (${sign}${roundedDelta.toFixed(1)}m)`;
  }

  if (Math.abs(roundedDelta) < 0.5) {
    return `Same Level (${sign}${roundedDelta.toFixed(1)}m)`;
  }

  const estimatedFloorOffset = Math.round(elevationDelta / 3.0);
  if (estimatedFloorOffset !== 0) {
    const floorLabel = estimatedFloorOffset > 0 ? `+${estimatedFloorOffset} Fl` : `${estimatedFloorOffset} Fl`;
    return `${floorLabel} (${sign}${roundedDelta.toFixed(1)}m)`;
  }

  return `Elevation ${sign}${roundedDelta.toFixed(1)}m`;
}
