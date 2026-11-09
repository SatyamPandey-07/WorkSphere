/**
 * Polygon geometry validation and repair conforming to RFC 7946 GeoJSON.
 *
 * Implements linear ring closedness verification, Bentley-Ottmann / sweep-line
 * line segment self-intersection detection, and geometry repair / simplification
 * (convex hull & bounding buffer) for spatial boundary exports.
 */

export type Position = [number, number]; // [longitude, latitude]

const EPSILON = 1e-9;

/**
 * Checks whether two 2D points are identical within floating-point tolerance.
 */
export function arePointsEqual(p1: Position | number[], p2: Position | number[]): boolean {
  return (
    Math.abs(p1[0] - p2[0]) < EPSILON &&
    Math.abs(p1[1] - p2[1]) < EPSILON
  );
}

/**
 * Validates whether a coordinate position is a valid geographic WGS84 coordinate [longitude, latitude].
 */
export function isValidPosition(pos: Position | number[]): boolean {
  if (!Array.isArray(pos) || pos.length < 2) return false;
  const [lng, lat] = pos;
  if (typeof lng !== "number" || typeof lat !== "number") return false;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  return lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
}

/**
 * Determines whether a linear ring is closed per RFC 7946 §3.1.6:
 * The ring must contain at least 4 positions and the first and last
 * coordinates must be identical.
 */
export function isPolygonRingClosed(ring: number[][]): boolean {
  if (!Array.isArray(ring) || ring.length < 4) {
    return false;
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  return arePointsEqual(first, last);
}

/**
 * Enforces linear ring closure by appending the starting vertex to the end if missing.
 */
export function ensurePolygonRingClosed(ring: number[][]): number[][] {
  if (!Array.isArray(ring) || ring.length === 0) return [];
  const cloned: number[][] = ring.map((p) => [p[0], p[1]]);
  if (cloned.length < 3) return cloned;
  if (!arePointsEqual(cloned[0], cloned[cloned.length - 1])) {
    cloned.push([cloned[0][0], cloned[0][1]]);
  }
  return cloned;
}

/**
 * Orientation of three ordered points:
 * 0 -> Collinear
 * 1 -> Clockwise
 * 2 -> Counterclockwise
 */
function orientation(p: number[], q: number[], r: number[]): number {
  const val = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]);
  if (Math.abs(val) < EPSILON) return 0;
  return val > 0 ? 1 : 2;
}

/**
 * Checks whether point q lies on line segment pr (assuming p, q, r are collinear).
 */
function onSegment(p: number[], q: number[], r: number[]): boolean {
  return (
    q[0] <= Math.max(p[0], r[0]) + EPSILON &&
    q[0] >= Math.min(p[0], r[0]) - EPSILON &&
    q[1] <= Math.max(p[1], r[1]) + EPSILON &&
    q[1] >= Math.min(p[1], r[1]) - EPSILON
  );
}

/**
 * Checks whether two 2D line segments (p1-p2) and (p3-p4) intersect.
 *
 * @param allowSharedEndpoint When true, segments that merely meet at a common
 * endpoint (e.g. adjacent edges in a polygon) are not treated as intersecting,
 * unless they overlap collinearly.
 */
export function doSegmentsIntersect(
  p1: number[],
  p2: number[],
  p3: number[],
  p4: number[],
  allowSharedEndpoint = false,
): boolean {
  const sharesP1P3 = arePointsEqual(p1, p3);
  const sharesP1P4 = arePointsEqual(p1, p4);
  const sharesP2P3 = arePointsEqual(p2, p3);
  const sharesP2P4 = arePointsEqual(p2, p4);
  const shared = sharesP1P3 || sharesP1P4 || sharesP2P3 || sharesP2P4;

  if (shared) {
    if (allowSharedEndpoint) {
      // Adjacent polygon segments sharing an endpoint must not overlap collinearly
      const o1 = orientation(p1, p2, p3);
      const o2 = orientation(p1, p2, p4);
      if (o1 === 0 && o2 === 0) {
        // Collinear test: check if opposite endpoints lie along the same segment
        if (sharesP1P3 && !arePointsEqual(p2, p4)) {
          if (onSegment(p1, p4, p2) || onSegment(p1, p2, p4)) return true;
        }
        if (sharesP2P4 && !arePointsEqual(p1, p3)) {
          if (onSegment(p2, p1, p3) || onSegment(p2, p3, p1)) return true;
        }
        if (sharesP1P4 && !arePointsEqual(p2, p3)) {
          if (onSegment(p1, p3, p2) || onSegment(p1, p2, p3)) return true;
        }
        if (sharesP2P3 && !arePointsEqual(p1, p4)) {
          if (onSegment(p2, p4, p1) || onSegment(p2, p1, p4)) return true;
        }
      }
      return false;
    }
  }

  // Quick bounding box rejection
  if (
    Math.max(p1[0], p2[0]) < Math.min(p3[0], p4[0]) - EPSILON ||
    Math.min(p1[0], p2[0]) > Math.max(p3[0], p4[0]) + EPSILON ||
    Math.max(p1[1], p2[1]) < Math.min(p3[1], p4[1]) - EPSILON ||
    Math.min(p1[1], p2[1]) > Math.max(p3[1], p4[1]) + EPSILON
  ) {
    return false;
  }

  const o1 = orientation(p1, p2, p3);
  const o2 = orientation(p1, p2, p4);
  const o3 = orientation(p3, p4, p1);
  const o4 = orientation(p3, p4, p2);

  // General straddle case
  if (o1 !== o2 && o3 !== o4) {
    return true;
  }

  // Special Collinear Cases
  if (o1 === 0 && onSegment(p1, p3, p2)) return true;
  if (o2 === 0 && onSegment(p1, p4, p2)) return true;
  if (o3 === 0 && onSegment(p3, p1, p4)) return true;
  if (o4 === 0 && onSegment(p3, p2, p4)) return true;

  return false;
}

export type IntersectionDetail = {
  segmentIndex1: number;
  segmentIndex2: number;
  p1: number[];
  p2: number[];
  p3: number[];
  p4: number[];
};

/**
 * Sweep-line segment comparison to detect any self-intersection in a polygon ring.
 * Non-adjacent segments must never intersect; adjacent segments may only meet at their shared vertex.
 */
export function findPolygonSelfIntersections(ring: number[][]): IntersectionDetail[] {
  if (!Array.isArray(ring) || ring.length < 4) return [];

  const closedRing = ensurePolygonRingClosed(ring);
  const numSegments = closedRing.length - 1;
  const intersections: IntersectionDetail[] = [];

  // Segment representation: [start, end, minX, maxX]
  type Segment = {
    index: number;
    p1: number[];
    p2: number[];
    minX: number;
    maxX: number;
  };

  const segments: Segment[] = [];
  for (let i = 0; i < numSegments; i++) {
    const p1 = closedRing[i];
    const p2 = closedRing[i + 1];
    segments.push({
      index: i,
      p1,
      p2,
      minX: Math.min(p1[0], p2[0]),
      maxX: Math.max(p1[0], p2[0]),
    });
  }

  // Sweep-line: Sort segments by their starting X position
  segments.sort((a, b) => a.minX - b.minX);

  // Check candidate overlapping segments
  for (let i = 0; i < segments.length; i++) {
    const segA = segments[i];
    for (let j = i + 1; j < segments.length; j++) {
      const segB = segments[j];

      // If segB starts after segA ends in X dimension, no further segments can intersect segA
      if (segB.minX > segA.maxX + EPSILON) {
        break;
      }

      // Check whether segA and segB are adjacent in the ring
      const idxA = segA.index;
      const idxB = segB.index;
      const isAdjacent =
        Math.abs(idxA - idxB) === 1 ||
        Math.abs(idxA - idxB) === numSegments - 1;

      if (doSegmentsIntersect(segA.p1, segA.p2, segB.p1, segB.p2, isAdjacent)) {
        intersections.push({
          segmentIndex1: Math.min(idxA, idxB),
          segmentIndex2: Math.max(idxA, idxB),
          p1: segA.p1,
          p2: segA.p2,
          p3: segB.p1,
          p4: segB.p2,
        });
      }
    }
  }

  return intersections;
}

/**
 * Returns true if the polygon ring has any self-intersections.
 */
export function hasPolygonSelfIntersection(ring: number[][]): boolean {
  return findPolygonSelfIntersections(ring).length > 0;
}

/**
 * Computes the signed area of a 2D polygon using the Shoelace formula.
 * Positive value indicates counter-clockwise orientation; negative indicates clockwise.
 */
export function computeSignedPolygonArea(ring: number[][]): number {
  if (!ring || ring.length < 3) return 0;
  let area = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += ring[i][0] * ring[j][1];
    area -= ring[j][0] * ring[i][1];
  }
  return area / 2;
}

/**
 * Enforces RFC 7946 §3.1.6 right-hand rule:
 * Exterior polygon rings must be counter-clockwise (positive signed area).
 */
export function ensureCounterClockwise(ring: number[][]): number[][] {
  const closed = ensurePolygonRingClosed(ring);
  const area = computeSignedPolygonArea(closed);
  if (area < 0) {
    // Reverse vertex order while preserving closure
    const reversed = closed.slice(0, -1).reverse();
    reversed.push([reversed[0][0], reversed[0][1]]);
    return reversed;
  }
  return closed;
}

export type PolygonValidationResult = {
  isValid: boolean;
  error?: string;
  intersections?: IntersectionDetail[];
};

/**
 * Validates a GeoJSON Polygon linear ring against RFC 7946 requirements:
 * 1. Must contain valid geographic coordinates (WGS84).
 * 2. Must contain at least 4 positions (including closure).
 * 3. Must be closed (first and last positions identical).
 * 4. Must not self-intersect (checked via sweep-line intersection algorithm).
 */
export function validatePolygonRing(ring: number[][]): PolygonValidationResult {
  if (!Array.isArray(ring)) {
    return { isValid: false, error: "Polygon ring must be an array of coordinate positions." };
  }

  if (ring.length < 4) {
    return {
      isValid: false,
      error: `A linear ring must have at least 4 coordinate positions (got ${ring.length}).`,
    };
  }

  for (let i = 0; i < ring.length; i++) {
    if (!isValidPosition(ring[i])) {
      return {
        isValid: false,
        error: `Invalid coordinate at position ${i}: [${ring[i]?.join(", ")}] is not a valid WGS84 position.`,
      };
    }
  }

  if (!isPolygonRingClosed(ring)) {
    return {
      isValid: false,
      error: "Linear ring is not closed: first and last coordinate positions must be identical.",
    };
  }

  const intersections = findPolygonSelfIntersections(ring);
  if (intersections.length > 0) {
    const { segmentIndex1, segmentIndex2 } = intersections[0];
    return {
      isValid: false,
      error: `Polygon ring self-intersects at segments ${segmentIndex1} and ${segmentIndex2}.`,
      intersections,
    };
  }

  return { isValid: true };
}

/**
 * Computes the 2D convex hull using Andrew's monotone chain algorithm ($O(n \log n)$).
 * Guaranteed to produce a simple, non-self-intersecting, counter-clockwise closed polygon ring.
 */
export function computeConvexHull(points: number[][]): number[][] {
  if (!points || points.length === 0) return [];

  // Deduplicate and filter valid points
  const uniquePoints: number[][] = [];
  const seen = new Set<string>();
  for (const pt of points) {
    if (!isValidPosition(pt)) continue;
    const key = `${pt[0].toFixed(8)},${pt[1].toFixed(8)}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniquePoints.push([pt[0], pt[1]]);
    }
  }

  if (uniquePoints.length < 3) {
    return uniquePoints;
  }

  // Sort by longitude (X), then latitude (Y)
  uniquePoints.sort((a, b) => a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]);

  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  // Build lower hull
  const lower: number[][] = [];
  for (const p of uniquePoints) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  // Build upper hull
  const upper: number[][] = [];
  for (let i = uniquePoints.length - 1; i >= 0; i--) {
    const p = uniquePoints[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  // Remove duplicate end points and concatenate
  lower.pop();
  upper.pop();
  const hull = lower.concat(upper);

  // Close the hull ring
  if (hull.length >= 3) {
    hull.push([hull[0][0], hull[0][1]]);
    return ensureCounterClockwise(hull);
  }

  return hull;
}

/**
 * Creates a buffered bounding box polygon around a set of coordinates.
 */
export function createBoundingBoxPolygon(
  points: number[][],
  paddingDegrees = 0.001,
): number[][] {
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  for (const pt of points) {
    if (!isValidPosition(pt)) continue;
    minLng = Math.min(minLng, pt[0]);
    maxLng = Math.max(maxLng, pt[0]);
    minLat = Math.min(minLat, pt[1]);
    maxLat = Math.max(maxLat, pt[1]);
  }

  if (!Number.isFinite(minLng)) {
    return [];
  }

  // Expand bounds by padding
  const west = Math.max(-180, minLng - paddingDegrees);
  const east = Math.min(180, maxLng + paddingDegrees);
  const south = Math.max(-90, minLat - paddingDegrees);
  const north = Math.min(90, maxLat + paddingDegrees);

  // Counter-clockwise closed rectangle per RFC 7946
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

/**
 * Repairs an invalid or self-intersecting polygon ring before export.
 * If already valid, returns the ring with RFC 7946 closure and CCW winding.
 * If self-intersecting or degenerate, simplifies the geometry via convex hull
 * or bounding envelope to guarantee a valid RFC 7946 linear ring.
 */
export function repairSelfIntersectingPolygon(
  ring: number[][],
  options: { bufferPadding?: number } = {},
): number[][] {
  const validation = validatePolygonRing(ring);
  if (validation.isValid) {
    return ensureCounterClockwise(ring);
  }

  // Fallback / Repair: Compute Convex Hull over all vertices
  const hull = computeConvexHull(ring);
  if (hull.length >= 4 && isPolygonRingClosed(hull) && !hasPolygonSelfIntersection(hull)) {
    return ensureCounterClockwise(hull);
  }

  // If vertices are collinear or insufficient for convex polygon, generate buffered bounding box
  return createBoundingBoxPolygon(ring, options.bufferPadding ?? 0.001);
}
