/**
 * Utility functions for 3D floor plan math.
 */

// We scale down the SVG coordinates (which are in hundreds) to a sensible 3D scale.
export const SCENE_SCALE = 0.05;

// The SVG viewBox width/height
export const SVG_WIDTH = 620;
export const SVG_HEIGHT = 470;

// Calculate offset to center the floor plan at (0, 0)
export const OFFSET_X = SVG_WIDTH / 2;
export const OFFSET_Z = SVG_HEIGHT / 2;

/**
 * Converts a 2D SVG coordinate and dimensions into a 3D position vector.
 * The SVG's top-left is (0,0), while Three.js uses center as (0,0).
 *
 * @param x Top-left X coordinate in SVG
 * @param y Top-left Y coordinate in SVG (which maps to Z in 3D)
 * @param width Width of the shape
 * @param height Height of the shape
 * @param yElevation The elevation (Y axis in 3D) of the center of the object
 */
export function get3DPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  yElevation: number = 0.5,
): [number, number, number] {
  // Center of the shape in SVG coordinates
  const cx = x + width / 2;
  const cy = y + height / 2; // cy maps to Z

  // Translate to center and apply scale
  const worldX = (cx - OFFSET_X) * SCENE_SCALE;
  const worldZ = (cy - OFFSET_Z) * SCENE_SCALE;

  return [worldX, yElevation, worldZ];
}

/**
 * Converts 2D SVG dimensions into 3D scale/dimensions.
 *
 * @param width SVG width
 * @param height SVG height
 * @param depth The thickness (Y axis in 3D) of the object
 */
export function get3DScale(
  width: number,
  height: number,
  depth: number = 1,
): [number, number, number] {
  return [width * SCENE_SCALE, depth, height * SCENE_SCALE];
}

/**
 * Common color palette for the 3D floor plan.
 */
export const FloorPlanColors = {
  AvailableDesk: "#166534",
  AvailableRoom: "#155e75",
  Selected: "#8b5cf6",
  Taken: "#3f3f46",
  Hover: "#a78bfa",
  Floor: "#111116",
  FloorLines: "#27272a",
};
