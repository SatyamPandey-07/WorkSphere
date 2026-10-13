/**
 * constructGenerator.ts
 * Parametric SVG and Canvas construct shape generator for hard-light geometric constructs
 * (glowing shields, energy hexagons, flight arrows, gears, beams).
 */

import type { ShapeData } from "@/lib/whiteboard/whiteboardCore";

export type ConstructType =
  "shield" | "hexagon" | "flightArrow" | "gear" | "beam";

export interface ConstructBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Extracts and normalizes the bounding box from shape points [x1, y1, x2, y2].
 */
export function getConstructBounds(points: number[]): ConstructBounds {
  if (!points || points.length < 2) {
    return { x: 0, y: 0, width: 60, height: 60 };
  }
  if (points.length < 4) {
    return { x: points[0], y: points[1], width: 60, height: 60 };
  }
  const x1 = points[0];
  const y1 = points[1];
  const x2 = points[2];
  const y2 = points[3];
  const minX = Math.min(x1, x2);
  const minY = Math.min(y1, y2);
  const width = Math.max(12, Math.abs(x2 - x1));
  const height = Math.max(12, Math.abs(y2 - y1));
  return { x: minX, y: minY, width, height };
}

/**
 * Converts a hex color string to an RGBA color string with specified alpha.
 */
export function hexToRgba(hex: string, alpha = 0.25): string {
  if (!hex || typeof hex !== "string" || !hex.startsWith("#")) {
    return `rgba(16, 185, 129, ${alpha})`;
  }
  const clean = hex.replace("#", "");
  let r = 16;
  let g = 185;
  let b = 129;
  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16);
    g = parseInt(clean[1] + clean[1], 16);
    b = parseInt(clean[2] + clean[2], 16);
  } else if (clean.length >= 6) {
    r = parseInt(clean.slice(0, 2), 16);
    g = parseInt(clean.slice(2, 4), 16);
    b = parseInt(clean.slice(4, 6), 16);
  }
  return `rgba(${isNaN(r) ? 16 : r}, ${isNaN(g) ? 185 : g}, ${isNaN(b) ? 129 : b}, ${alpha})`;
}

/**
 * Generates an SVG path data string for the specified parametric construct shape.
 */
export function generateConstructSvgPath(
  type: ConstructType = "shield",
  bounds: ConstructBounds,
): string {
  const { x, y, width, height } = bounds;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const rx = width / 2;
  const ry = height / 2;

  switch (type) {
    case "shield": {
      // Parametric hard-light heater/energy shield
      return (
        `M ${cx} ${y} ` +
        `Q ${x + width} ${y} ${x + width} ${y + height * 0.42} ` +
        `Q ${x + width} ${y + height * 0.82} ${cx} ${y + height} ` +
        `Q ${x} ${y + height * 0.82} ${x} ${y + height * 0.42} ` +
        `Q ${x} ${y} ${cx} ${y} Z`
      );
    }

    case "hexagon": {
      // Parametric 6-sided energy matrix hexagon (pointy-topped)
      const points: string[] = [];
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3 - Math.PI / 6;
        const px = cx + rx * Math.cos(angle);
        const py = cy + ry * Math.sin(angle);
        points.push(`${i === 0 ? "M" : "L"} ${px.toFixed(1)} ${py.toFixed(1)}`);
      }
      return `${points.join(" ")} Z`;
    }

    case "flightArrow": {
      // Parametric tactical supersonic chevron flight vector arrow
      const apexX = cx;
      const apexY = y;
      const rightWingX = x + width;
      const rightWingY = y + height;
      const notchX = cx;
      const notchY = y + height * 0.68;
      const leftWingX = x;
      const leftWingY = y + height;
      return (
        `M ${apexX} ${apexY} ` +
        `L ${rightWingX} ${rightWingY} ` +
        `L ${notchX} ${notchY} ` +
        `L ${leftWingX} ${leftWingY} Z`
      );
    }

    case "gear": {
      // Parametric mechanical power gear with 8 hard-light teeth
      const teeth = 8;
      const numPts = teeth * 2;
      const outerR = Math.min(rx, ry);
      const innerR = outerR * 0.72;
      const pts: string[] = [];
      for (let i = 0; i < numPts; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const angle = (i * Math.PI * 2) / numPts;
        const px = cx + ((r * rx) / outerR) * Math.cos(angle);
        const py = cy + ((r * ry) / outerR) * Math.sin(angle);
        pts.push(`${i === 0 ? "M" : "L"} ${px.toFixed(1)} ${py.toFixed(1)}`);
      }
      return `${pts.join(" ")} Z`;
    }

    case "beam":
    default: {
      // Parametric high-energy beam bracket
      const bH = height * 0.4;
      const topY = cy - bH / 2;
      const botY = cy + bH / 2;
      return (
        `M ${x + 12} ${topY} ` +
        `L ${x + width - 12} ${topY} ` +
        `L ${x + width} ${cy} ` +
        `L ${x + width - 12} ${botY} ` +
        `L ${x + 12} ${botY} ` +
        `L ${x} ${cy} Z`
      );
    }
  }
}

/**
 * Traces the construct shape path onto a 2D canvas rendering context.
 */
export function traceConstructPath(
  ctx: CanvasRenderingContext2D,
  type: ConstructType,
  bounds: ConstructBounds,
): void {
  const { x, y, width, height } = bounds;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const rx = width / 2;
  const ry = height / 2;

  ctx.beginPath();

  switch (type) {
    case "shield": {
      ctx.moveTo(cx, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + height * 0.42);
      ctx.quadraticCurveTo(x + width, y + height * 0.82, cx, y + height);
      ctx.quadraticCurveTo(x, y + height * 0.82, x, y + height * 0.42);
      ctx.quadraticCurveTo(x, y, cx, y);
      ctx.closePath();
      break;
    }

    case "hexagon": {
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3 - Math.PI / 6;
        const px = cx + rx * Math.cos(angle);
        const py = cy + ry * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }

    case "flightArrow": {
      ctx.moveTo(cx, y);
      ctx.lineTo(x + width, y + height);
      ctx.lineTo(cx, y + height * 0.68);
      ctx.lineTo(x, y + height);
      ctx.closePath();
      break;
    }

    case "gear": {
      const teeth = 8;
      const numPts = teeth * 2;
      const outerR = Math.min(rx, ry);
      const innerR = outerR * 0.72;
      for (let i = 0; i < numPts; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const angle = (i * Math.PI * 2) / numPts;
        const px = cx + ((r * rx) / outerR) * Math.cos(angle);
        const py = cy + ((r * ry) / outerR) * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }

    case "beam":
    default: {
      const bH = height * 0.4;
      const topY = cy - bH / 2;
      const botY = cy + bH / 2;
      ctx.moveTo(x + 12, topY);
      ctx.lineTo(x + width - 12, topY);
      ctx.lineTo(x + width, cy);
      ctx.lineTo(x + width - 12, botY);
      ctx.lineTo(x + 12, botY);
      ctx.lineTo(x, cy);
      ctx.closePath();
      break;
    }
  }
}

/**
 * Draws secondary internal hard-light facet lines and energy crests.
 */
function drawConstructCore(
  ctx: CanvasRenderingContext2D,
  type: ConstructType,
  bounds: ConstructBounds,
  baseColor: string,
): void {
  const { x, y, width, height } = bounds;
  const cx = x + width / 2;
  const cy = y + height / 2;

  ctx.save();
  ctx.strokeStyle = baseColor;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.55;

  if (type === "shield") {
    // Inner energy crest crosshair
    ctx.beginPath();
    ctx.moveTo(cx, y + height * 0.15);
    ctx.lineTo(cx, y + height * 0.75);
    ctx.moveTo(x + width * 0.22, y + height * 0.38);
    ctx.lineTo(x + width * 0.78, y + height * 0.38);
    ctx.stroke();
  } else if (type === "hexagon") {
    // Inner concentric energy cell
    const innerBounds: ConstructBounds = {
      x: x + width * 0.22,
      y: y + height * 0.22,
      width: width * 0.56,
      height: height * 0.56,
    };
    traceConstructPath(ctx, "hexagon", innerBounds);
    ctx.stroke();
  } else if (type === "flightArrow") {
    // Inner tactical flight vector line
    ctx.beginPath();
    ctx.moveTo(cx, y + height * 0.18);
    ctx.lineTo(cx, y + height * 0.68);
    ctx.stroke();
  } else if (type === "gear") {
    // Central gear axis hub
    ctx.beginPath();
    const hubRadius = Math.min(width, height) * 0.2;
    ctx.arc(cx, cy, hubRadius, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Renders a complete parametric construct shape with glowing neon strokes,
 * semi-transparent emerald fill, and translucent energy borders onto Canvas.
 */
export function renderConstructToCanvas(
  ctx: CanvasRenderingContext2D,
  shape: ShapeData,
): void {
  if (!shape.points || shape.points.length < 2) return;

  const bounds = getConstructBounds(shape.points);
  const type = shape.constructType || "shield";
  const baseColor = shape.color || "#00FF88"; // Emerald neon green hard-light

  ctx.save();
  ctx.globalAlpha = shape.opacity ?? 1;

  // 1. Semi-transparent emerald neon fill
  const fillRgba = hexToRgba(baseColor, 0.22);
  ctx.fillStyle = fillRgba;

  // 2. Glowing neon stroke
  ctx.strokeStyle = baseColor;
  ctx.lineWidth = Math.max(2, shape.width || 3);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = "#10b981";
  ctx.shadowBlur = 10;

  traceConstructPath(ctx, type, bounds);
  ctx.fill();
  ctx.stroke();

  // 3. Translucent hard-light energy border (inner crisp highlight stroke)
  ctx.shadowBlur = 4;
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.65)";
  ctx.stroke();

  // 4. Secondary internal energetic facets
  drawConstructCore(ctx, type, bounds, baseColor);

  ctx.restore();
}

/**
 * Generates an SVG XML representation of a parametric construct shape.
 */
export function renderConstructSvg(shape: ShapeData): string {
  const bounds = getConstructBounds(shape.points);
  const type = shape.constructType || "shield";
  const baseColor = shape.color || "#10b981";
  const fillRgba = hexToRgba(baseColor, 0.22);
  const strokeWidth = Math.max(2, shape.width || 3);
  const opacity = shape.opacity ?? 1;
  const pathD = generateConstructSvgPath(type, bounds);

  return (
    `<g opacity="${opacity}">` +
    `<path d="${pathD}" fill="${fillRgba}" stroke="${baseColor}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round" />` +
    `<path d="${pathD}" fill="none" stroke="rgba(255, 255, 255, 0.6)" stroke-width="1" />` +
    `</g>`
  );
}
