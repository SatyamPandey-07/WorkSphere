/**
 * contourSvgExporter.ts
 * Translates extracted contours from contour_tracer.c into clean, normalized SVG path elements
 * suitable for architectural CAD editing and vector downloads.
 */

export interface ContourPoint {
  x: number;
  y: number;
}

export type ContourPolygon = ContourPoint[];

export interface ContourSvgExportOptions {
  strokeColor?: string;
  strokeWidth?: number;
  fillColor?: string;
  normalize?: boolean; // If true, normalizes coordinates to [0, 1] relative to width/height
  precision?: number;  // Decimal places for points (default 2)
  includeMetadata?: boolean;
  minPoints?: number;     // Minimum number of points required (default 3, discards < 3)
  minPerimeter?: number;  // Minimum perimeter length in pixels (default 10px)
}

// Backward compatibility alias for SvgExportOptions
export type SvgExportOptions = ContourSvgExportOptions;

export const DEFAULT_MIN_CONTOUR_POINTS = 3;
export const DEFAULT_MIN_CONTOUR_PERIMETER = 10;

/**
 * Calculates the total perimeter length of a contour polygon.
 */
export function calculateContourPerimeter(polygon: ContourPolygon): number {
  if (!polygon || polygon.length < 2) return 0;
  let perimeter = 0;
  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % polygon.length];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    perimeter += Math.sqrt(dx * dx + dy * dy);
  }
  return perimeter;
}

/**
 * Checks if a contour polygon is degenerate (e.g. single point, line with 0 perimeter, or noise artifact).
 */
export function isValidContour(
  polygon: ContourPolygon,
  minPoints: number = DEFAULT_MIN_CONTOUR_POINTS,
  minPerimeter: number = DEFAULT_MIN_CONTOUR_PERIMETER
): boolean {
  if (!polygon || polygon.length < minPoints) {
    return false;
  }

  // Check if all points are identical (single-pixel artifact)
  let allIdentical = true;
  const first = polygon[0];
  for (let i = 1; i < polygon.length; i++) {
    if (polygon[i].x !== first.x || polygon[i].y !== first.y) {
      allIdentical = false;
      break;
    }
  }
  if (allIdentical) {
    return false;
  }

  // Check perimeter threshold
  const perimeter = calculateContourPerimeter(polygon);
  if (perimeter < minPerimeter) {
    return false;
  }

  return true;
}

export const CONTOUR_STROKE_PRESETS = {
  blueprintBlue: {
    label: "Blueprint Blue",
    strokeColor: "#0284c7",
    fillColor: "rgba(14, 165, 233, 0.15)",
  },
  emeraldGreen: {
    label: "Emerald Green",
    strokeColor: "#059669",
    fillColor: "rgba(16, 185, 129, 0.15)",
  },
  minimalistCharcoal: {
    label: "Minimalist Charcoal",
    strokeColor: "#334155",
    fillColor: "rgba(51, 65, 85, 0.15)",
  },
  cadAmber: {
    label: "CAD Amber",
    strokeColor: "#d97706",
    fillColor: "rgba(245, 158, 11, 0.15)",
  },
} as const;

export const CONTOUR_STROKE_WIDTHS = [1, 2, 3, 4] as const;

/**
 * Converts an array of contour polygons (as traced by contour_tracer.c) into normalized SVG path strings.
 * Discards degenerate single-pixel artifacts and paths below minimum perimeter threshold (#5735).
 * Example: "M 10 10 L 100 10 L 100 100 Z"
 */
export function contourToSvgPathData(
  polygon: ContourPolygon,
  width: number,
  height: number,
  options: SvgExportOptions = {}
): string {
  if (!polygon || polygon.length === 0) {
    return "";
  }

  const {
    normalize = false,
    precision = 2,
    minPoints = DEFAULT_MIN_CONTOUR_POINTS,
    minPerimeter = DEFAULT_MIN_CONTOUR_PERIMETER,
  } = options;

  if (!isValidContour(polygon, minPoints, minPerimeter)) {
    return "";
  }

  const scaleX = normalize && width > 0 ? 1 / width : 1;
  const scaleY = normalize && height > 0 ? 1 / height : 1;

  const formatCoord = (val: number, scale: number): string => {
    const scaled = val * scale;
    return Number(scaled.toFixed(precision)).toString();
  };

  const commands = polygon.map((pt, idx) => {
    const xStr = formatCoord(pt.x, scaleX);
    const yStr = formatCoord(pt.y, scaleY);
    return idx === 0 ? `M ${xStr} ${yStr}` : `L ${xStr} ${yStr}`;
  });

  return `${commands.join(" ")} Z`;
}

/**
 * Generates a complete standalone SVG document containing extracted floor plan contours.
 */
export function generateFloorplanSvg(
  contours: ContourPolygon[],
  width: number,
  height: number,
  venueId: string = "venue",
  options: SvgExportOptions = {}
): string {
  const {
    strokeColor = "#0284c7",
    strokeWidth = 2,
    fillColor = "rgba(14, 165, 233, 0.15)",
    includeMetadata = true,
  } = options;

  const viewBoxWidth = width > 0 ? width : 800;
  const viewBoxHeight = height > 0 ? height : 600;

  const validPaths: string[] = [];
  for (const contour of contours) {
    const d = contourToSvgPathData(contour, viewBoxWidth, viewBoxHeight, options);
    if (d) {
      validPaths.push(d);
    }
  }

  const pathElements = validPaths
    .map((d, index) => {
      return `    <path id="contour-${index + 1}" d="${d}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round" />`;
    })
    .join("\n");

  const metadataComment = includeMetadata
    ? `  <!-- Generated by WorkSphere Floor Plan Vectorizer (contour_tracer.c) -->\n  <!-- Venue: ${venueId} | Contours: ${validPaths.length} | ViewBox: 0 0 ${viewBoxWidth} ${viewBoxHeight} -->\n`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxWidth} ${viewBoxHeight}" width="${viewBoxWidth}" height="${viewBoxHeight}">
${metadataComment}  <g id="floorplan-contours" class="architectural-contours">
${pathElements}
  </g>
</svg>`;
}

/**
 * Triggers client-side download of the generated SVG vector file.
 * The file is named `[venueId]-floorplan-vector.svg`.
 */
export function downloadFloorplanSvg(
  contours: ContourPolygon[],
  width: number,
  height: number,
  venueId: string = "venue",
  options: SvgExportOptions = {}
): string {
  const sanitizedVenueId = venueId.replace(/[^a-zA-Z0-9_-]/g, "_") || "venue";
  const filename = `${sanitizedVenueId}-floorplan-vector.svg`;
  const svgContent = generateFloorplanSvg(contours, width, height, sanitizedVenueId, options);

  if (typeof window !== "undefined" && typeof document !== "undefined") {
    const blob = new Blob([svgContent], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return filename;
}
