/**
 * splineCoordinates.ts
 *
 * Implements canvas coordinate transformations between local screen space
 * and shared world space via inverse 2D affine view matrices, and Catmull-Rom /
 * cubic Bezier spline interpolation to smooth multi-peer collaborative strokes.
 */

export interface CanvasViewTransform {
  /** Zoom scale multiplier, e.g. 0.5 (50%) to 3.0 (300%). Default: 1.0 */
  scale: number;
  /** Pan horizontal offset in screen pixels. Default: 0 */
  panX: number;
  /** Pan vertical offset in screen pixels. Default: 0 */
  panY: number;
}

export const DEFAULT_VIEW_TRANSFORM: CanvasViewTransform = {
  scale: 1.0,
  panX: 0,
  panY: 0,
};

/**
 * Transforms local screen coordinates into world space coordinates
 * through the inverse canvas view matrix:
 *
 * [x_world]   [1/scale     0      -panX/scale] [x_screen]
 * [y_world] = [   0     1/scale   -panY/scale] [y_screen]
 * [   1   ]   [   0        0           1     ] [   1    ]
 */
export function screenToWorld(
  screenX: number,
  screenY: number,
  transform: CanvasViewTransform = DEFAULT_VIEW_TRANSFORM,
): [number, number] {
  const scale =
    Number.isFinite(transform.scale) && transform.scale > 0
      ? transform.scale
      : 1.0;
  const panX = Number.isFinite(transform.panX) ? transform.panX : 0;
  const panY = Number.isFinite(transform.panY) ? transform.panY : 0;

  const worldX = (screenX - panX) / scale;
  const worldY = (screenY - panY) / scale;
  return [worldX, worldY];
}

/**
 * Transforms world space coordinates into local screen coordinates
 * through the canvas view matrix:
 *
 * x_screen = x_world * scale + panX
 * y_screen = y_world * scale + panY
 */
export function worldToScreen(
  worldX: number,
  worldY: number,
  transform: CanvasViewTransform = DEFAULT_VIEW_TRANSFORM,
): [number, number] {
  const scale =
    Number.isFinite(transform.scale) && transform.scale > 0
      ? transform.scale
      : 1.0;
  const panX = Number.isFinite(transform.panX) ? transform.panX : 0;
  const panY = Number.isFinite(transform.panY) ? transform.panY : 0;

  const screenX = worldX * scale + panX;
  const screenY = worldY * scale + panY;
  return [screenX, screenY];
}

export interface BezierSegment {
  cp1x: number;
  cp1y: number;
  cp2x: number;
  cp2y: number;
  endX: number;
  endY: number;
}

/**
 * Converts a sequence of 2D points [x0, y0, x1, y1, ...] into cubic Bezier curve
 * segments using Catmull-Rom spline tangents. Produces C1-continuous smooth paths
 * passing through every original input coordinate.
 *
 * @param points Flat array of coordinate pairs [x0, y0, x1, y1, ...]
 * @param tension Catmull-Rom tangent divisor (default: 6 for standard centripetal Bezier conversion)
 */
export function catmullRomToBezier(
  points: number[],
  tension = 6,
): BezierSegment[] {
  const numPoints = Math.floor(points.length / 2);
  if (numPoints < 2) return [];

  const segments: BezierSegment[] = [];

  for (let i = 0; i < numPoints - 1; i++) {
    const p0x = i > 0 ? points[(i - 1) * 2] : points[i * 2];
    const p0y = i > 0 ? points[(i - 1) * 2 + 1] : points[i * 2 + 1];

    const p1x = points[i * 2];
    const p1y = points[i * 2 + 1];

    const p2x = points[(i + 1) * 2];
    const p2y = points[(i + 1) * 2 + 1];

    const p3x = i + 2 < numPoints ? points[(i + 2) * 2] : points[(i + 1) * 2];
    const p3y =
      i + 2 < numPoints ? points[(i + 2) * 2 + 1] : points[(i + 1) * 2 + 1];

    const cp1x = p1x + (p2x - p0x) / tension;
    const cp1y = p1y + (p2y - p0y) / tension;

    const cp2x = p2x - (p3x - p1x) / tension;
    const cp2y = p2y - (p3y - p1y) / tension;

    segments.push({
      cp1x,
      cp1y,
      cp2x,
      cp2y,
      endX: p2x,
      endY: p2y,
    });
  }

  return segments;
}

/**
 * Draws a smooth Catmull-Rom cubic Bezier spline path onto a 2D canvas context.
 * Gracefully falls back to linear segments if bezierCurveTo is not available.
 */
export function drawSmoothSpline(
  ctx: CanvasRenderingContext2D,
  points: number[],
  tension = 6,
): void {
  const numPoints = Math.floor(points.length / 2);
  if (numPoints < 1) return;

  if (numPoints === 1) {
    ctx.moveTo(points[0], points[1]);
    ctx.lineTo(points[0] + 0.1, points[1] + 0.1);
    return;
  }

  if (numPoints === 2 || typeof ctx.bezierCurveTo !== "function") {
    ctx.moveTo(points[0], points[1]);
    for (let i = 1; i < numPoints; i++) {
      ctx.lineTo(points[i * 2], points[i * 2 + 1]);
    }
    return;
  }

  const segments = catmullRomToBezier(points, tension);
  ctx.moveTo(points[0], points[1]);

  for (const seg of segments) {
    ctx.bezierCurveTo(
      seg.cp1x,
      seg.cp1y,
      seg.cp2x,
      seg.cp2y,
      seg.endX,
      seg.endY,
    );
  }
}

/**
 * Evaluates Catmull-Rom spline points at intermediate t values [0, 1] for batch interpolation.
 * Useful for smoothing batches of sparse remote coordinate updates.
 */
export function interpolateCatmullRomPoints(
  points: number[],
  subdivisions = 4,
): number[] {
  const numPoints = Math.floor(points.length / 2);
  if (numPoints < 2) return points.slice();

  const interpolated: number[] = [points[0], points[1]];

  for (let i = 0; i < numPoints - 1; i++) {
    const p0x = i > 0 ? points[(i - 1) * 2] : points[i * 2];
    const p0y = i > 0 ? points[(i - 1) * 2 + 1] : points[i * 2 + 1];

    const p1x = points[i * 2];
    const p1y = points[i * 2 + 1];

    const p2x = points[(i + 1) * 2];
    const p2y = points[(i + 1) * 2 + 1];

    const p3x = i + 2 < numPoints ? points[(i + 2) * 2] : points[(i + 1) * 2];
    const p3y =
      i + 2 < numPoints ? points[(i + 2) * 2 + 1] : points[(i + 1) * 2 + 1];

    for (let step = 1; step <= subdivisions; step++) {
      const t = step / subdivisions;
      const t2 = t * t;
      const t3 = t2 * t;

      // Standard Catmull-Rom basis functions
      const b0 = -0.5 * t3 + t2 - 0.5 * t;
      const b1 = 1.5 * t3 - 2.5 * t2 + 1.0;
      const b2 = -1.5 * t3 + 2.0 * t2 + 0.5 * t;
      const b3 = 0.5 * t3 - 0.5 * t2;

      const x = b0 * p0x + b1 * p1x + b2 * p2x + b3 * p3x;
      const y = b0 * p0y + b1 * p1y + b2 * p2y + b3 * p3y;

      interpolated.push(x, y);
    }
  }

  return interpolated;
}
