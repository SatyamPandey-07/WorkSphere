import type { ShapeData } from "@/hooks/useCanvasWhiteboard";

export interface ExportCanvasOptions {
  width?: number;
  height?: number;
  filename?: string;
  scale?: number;
  pixelRatio?: 1 | 2 | 4;
  padding?: number;
  transparentBackground?: boolean;
}

export type CanvasExportOptions = ExportCanvasOptions;

/**
 * Escapes characters for XML/SVG text nodes and attributes.
 */
export function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
      default:
        return c;
    }
  });
}

/**
 * Calculates the bounding box enclosing all active shapes on the whiteboard.
 */
export function calculateCanvasBounds(
  shapes: ShapeData[],
  fallbackWidth = 1200,
  fallbackHeight = 800,
  padding = 32,
): { minX: number; minY: number; width: number; height: number } {
  const activeShapes = shapes.filter((s) => !s.deleted && s.points.length >= 2);

  if (activeShapes.length === 0) {
    return { minX: 0, minY: 0, width: fallbackWidth, height: fallbackHeight };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const shape of activeShapes) {
    const halfWidth = (shape.width || 2) / 2;

    if (shape.type === "sticky") {
      const sx = shape.points[0];
      const sy = shape.points[1];
      const right = shape.points[2] ?? sx + 220;
      const bottom = shape.points[3] ?? sy + 160;
      const w = Math.max(160, right - sx);
      const h = Math.max(120, bottom - sy);

      minX = Math.min(minX, sx);
      minY = Math.min(minY, sy);
      maxX = Math.max(maxX, sx + w);
      maxY = Math.max(maxY, sy + h);
      continue;
    }

    for (let i = 0; i < shape.points.length; i += 2) {
      const x = shape.points[i];
      const y = shape.points[i + 1];

      if (Number.isFinite(x) && Number.isFinite(y)) {
        minX = Math.min(minX, x - halfWidth);
        minY = Math.min(minY, y - halfWidth);
        maxX = Math.max(maxX, x + halfWidth);
        maxY = Math.max(maxY, y + halfWidth);
      }
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { minX: 0, minY: 0, width: fallbackWidth, height: fallbackHeight };
  }

  // Anchor to 0,0 if shapes are in standard positive quadrant
  const startX = Math.min(0, minX - padding);
  const startY = Math.min(0, minY - padding);
  const endX = Math.max(fallbackWidth, maxX + padding);
  const endY = Math.max(fallbackHeight, maxY + padding);

  return {
    minX: startX,
    minY: startY,
    width: Math.max(fallbackWidth, Math.ceil(endX - startX)),
    height: Math.max(fallbackHeight, Math.ceil(endY - startY)),
  };
}

/**
 * Triggers a client-side file download for a generated blob or data URI.
 */
export function triggerDownload(url: string, filename: string): void {
  if (typeof document === "undefined") return;
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Draws rounded rectangle path for sticky notes on CanvasRenderingContext2D.
 */
function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius = 6,
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Exports whiteboard shapes to a transparent PNG file.
 */
export async function exportCanvasAsPng(
  shapes: ShapeData[],
  options: ExportCanvasOptions = {},
): Promise<Blob | null> {
  if (typeof document === "undefined") return null;

  const bounds = calculateCanvasBounds(
    shapes,
    options.width,
    options.height,
    options.padding,
  );
  const width = options.width ?? bounds.width;
  const height = options.height ?? bounds.height;
  const scale = options.pixelRatio ?? options.scale ?? 2;
  const filename = options.filename ?? `whiteboard-${Date.now()}.png`;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const errorMsg =
      "Failed to acquire 2D rendering context from canvas: getContext('2d') returned null";
    console.error(`[canvasExport] ${errorMsg}`);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("whiteboard:export-error", {
          detail: { message: errorMsg },
        }),
      );
    }
    return null;
  }

  ctx.scale(scale, scale);
  // Maintain true transparent canvas alpha without dark background fill
  ctx.clearRect(0, 0, width, height);

  const activeShapes = shapes.filter((s) => !s.deleted && s.points.length >= 2);

  for (const shape of activeShapes) {
    ctx.save();
    ctx.globalAlpha = shape.opacity ?? 1;

    if (shape.type === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = shape.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(shape.points[0], shape.points[1]);
      for (let i = 2; i < shape.points.length; i += 2) {
        ctx.lineTo(shape.points[i], shape.points[i + 1]);
      }
      ctx.stroke();
      ctx.restore();
      continue;
    }

    ctx.strokeStyle = shape.color;
    ctx.lineWidth = shape.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (shape.type === "pen") {
      ctx.beginPath();
      ctx.moveTo(shape.points[0], shape.points[1]);
      for (let i = 2; i < shape.points.length; i += 2) {
        ctx.lineTo(shape.points[i], shape.points[i + 1]);
      }
      ctx.stroke();
    } else if (shape.type === "line") {
      ctx.beginPath();
      ctx.moveTo(shape.points[0], shape.points[1]);
      ctx.lineTo(shape.points[2], shape.points[3]);
      ctx.stroke();
    } else if (shape.type === "rect") {
      const x = shape.points[0];
      const y = shape.points[1];
      const w = shape.points[2] - x;
      const h = shape.points[3] - y;
      ctx.strokeRect(x, y, w, h);
    } else if (shape.type === "circle") {
      const cx = shape.points[0];
      const cy = shape.points[1];
      const ex = shape.points.length >= 4 ? shape.points[2] : cx;
      const ey = shape.points.length >= 4 ? shape.points[3] : cy;
      const rx = Math.abs(ex - cx);
      const ry = Math.abs(ey - cy);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx || 1, ry || 1, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (shape.type === "sticky") {
      const x = shape.points[0];
      const y = shape.points[1];
      const right = shape.points[2] ?? x + 220;
      const bottom = shape.points[3] ?? y + 160;
      const w = Math.max(160, right - x);
      const h = Math.max(120, bottom - y);

      // Sticky note background
      ctx.fillStyle = "#fef08a"; // Amber-100/Yellow-200
      ctx.strokeStyle = "#eab308";
      ctx.lineWidth = 1;
      drawRoundRect(ctx, x, y, w, h, 6);
      ctx.fill();
      ctx.stroke();

      // Sticky note header
      ctx.fillStyle = "#fde047";
      ctx.beginPath();
      ctx.moveTo(x + 6, y);
      ctx.lineTo(x + w - 6, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + 6);
      ctx.lineTo(x + w, y + 24);
      ctx.lineTo(x, y + 24);
      ctx.lineTo(x, y + 6);
      ctx.quadraticCurveTo(x, y, x + 6, y);
      ctx.closePath();
      ctx.fill();

      // Header title
      ctx.fillStyle = "#854d0e";
      ctx.font = "bold 10px sans-serif";
      ctx.fillText("STICKY NOTE", x + 8, y + 16);

      // Text content preview
      if (shape.text) {
        ctx.fillStyle = "#1e293b";
        ctx.font = "11px sans-serif";
        const lines = shape.text.replace(/^[#*\-`\s]+/gm, "").split("\n");
        let lineY = y + 40;
        for (const line of lines) {
          if (lineY > y + h - 10) break;
          ctx.fillText(line.slice(0, 30), x + 8, lineY);
          lineY += 15;
        }
      }
    }

    ctx.restore();
  }

  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        triggerDownload(url, filename);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
      resolve(blob);
    }, "image/png");
  });
}

/**
 * Exports whiteboard shapes to a PNG Blob, rejecting with an error if getContext('2d') is null.
 */
export async function exportCanvasToBlob(
  shapesOrCanvas: ShapeData[] | HTMLCanvasElement,
  options: ExportCanvasOptions = {},
): Promise<Blob> {
  let canvas: HTMLCanvasElement;

  if (shapesOrCanvas instanceof HTMLCanvasElement) {
    canvas = shapesOrCanvas;
  } else {
    if (typeof document === "undefined") {
      throw new Error("Canvas export is only supported in browser environments.");
    }
    const bounds = calculateCanvasBounds(
      shapesOrCanvas,
      options.width,
      options.height,
      options.padding,
    );
    const width = options.width ?? bounds.width;
    const height = options.height ?? bounds.height;
    const scale = options.pixelRatio ?? options.scale ?? 2;

    canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      const errorMsg =
        "Failed to acquire 2D rendering context from canvas: getContext('2d') returned null";
      console.error(`[canvasExport] ${errorMsg}`);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("whiteboard:export-error", {
            detail: { message: errorMsg },
          }),
        );
      }
      throw new Error(errorMsg);
    }

    ctx.scale(scale, scale);
    ctx.clearRect(0, 0, width, height);

    const activeShapes = shapesOrCanvas.filter((s) => !s.deleted && s.points.length >= 2);
    for (const shape of activeShapes) {
      ctx.save();
      ctx.globalAlpha = shape.opacity ?? 1;

      if (shape.type === "eraser") {
        ctx.globalCompositeOperation = "destination-out";
        ctx.lineWidth = shape.width;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(shape.points[0], shape.points[1]);
        for (let i = 2; i < shape.points.length; i += 2) {
          ctx.lineTo(shape.points[i], shape.points[i + 1]);
        }
        ctx.stroke();
        ctx.restore();
        continue;
      }

      ctx.strokeStyle = shape.color;
      ctx.lineWidth = shape.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (shape.type === "pen") {
        ctx.beginPath();
        ctx.moveTo(shape.points[0], shape.points[1]);
        for (let i = 2; i < shape.points.length; i += 2) {
          ctx.lineTo(shape.points[i], shape.points[i + 1]);
        }
        ctx.stroke();
      } else if (shape.type === "line") {
        ctx.beginPath();
        ctx.moveTo(shape.points[0], shape.points[1]);
        ctx.lineTo(shape.points[2], shape.points[3]);
        ctx.stroke();
      } else if (shape.type === "rect") {
        const x = shape.points[0];
        const y = shape.points[1];
        const w = shape.points[2] - x;
        const h = shape.points[3] - y;
        ctx.strokeRect(x, y, w, h);
      } else if (shape.type === "circle") {
        const cx = shape.points[0];
        const cy = shape.points[1];
        const ex = shape.points.length >= 4 ? shape.points[2] : cx;
        const ey = shape.points.length >= 4 ? shape.points[3] : cy;
        const rx = Math.abs(ex - cx);
        const ry = Math.abs(ey - cy);
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx || 1, ry || 1, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (shape.type === "sticky") {
        const x = shape.points[0];
        const y = shape.points[1];
        const right = shape.points[2] ?? x + 220;
        const bottom = shape.points[3] ?? y + 160;
        const w = Math.max(160, right - x);
        const h = Math.max(120, bottom - y);

        ctx.fillStyle = "#fef08a";
        ctx.strokeStyle = "#eab308";
        ctx.lineWidth = 1;
        drawRoundRect(ctx, x, y, w, h, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#fde047";
        ctx.beginPath();
        ctx.moveTo(x + 6, y);
        ctx.lineTo(x + w - 6, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + 6);
        ctx.lineTo(x + w, y + 24);
        ctx.lineTo(x, y + 24);
        ctx.lineTo(x, y + 6);
        ctx.quadraticCurveTo(x, y, x + 6, y);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = "#854d0e";
        ctx.font = "bold 10px sans-serif";
        ctx.fillText("STICKY NOTE", x + 8, y + 16);

        if (shape.text) {
          ctx.fillStyle = "#1e293b";
          ctx.font = "11px sans-serif";
          const lines = shape.text.replace(/^[#*\-`\s]+/gm, "").split("\n");
          let lineY = y + 40;
          for (const line of lines) {
            if (lineY > y + h - 10) break;
            ctx.fillText(line.slice(0, 30), x + 8, lineY);
            lineY += 15;
          }
        }
      }

      ctx.restore();
    }
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const errorMsg =
      "Failed to acquire 2D rendering context from canvas: getContext('2d') returned null";
    console.error(`[canvasExport] ${errorMsg}`);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("whiteboard:export-error", {
          detail: { message: errorMsg },
        }),
      );
    }
    throw new Error(errorMsg);
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Canvas serialization failed: toBlob returned null"));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

/**
 * Generates an SVG XML string representing the transparent whiteboard canvas.
 */
export function generateSvgString(
  shapes: ShapeData[],
  options: ExportCanvasOptions = {},
): string {
  const bounds = calculateCanvasBounds(
    shapes,
    options.width,
    options.height,
    options.padding,
  );
  const width = options.width ?? bounds.width;
  const height = options.height ?? bounds.height;
  const minX = bounds.minX;
  const minY = bounds.minY;

  const activeShapes = shapes.filter((s) => !s.deleted && s.points.length >= 2);
  const svgElements: string[] = [];

  for (const shape of activeShapes) {
    if (shape.type === "eraser") {
      // Eraser removes strokes on transparent background
      continue;
    }

    const color = escapeXml(shape.color || "#ffffff");
    const strokeWidth = shape.width || 2;
    const opacity = shape.opacity ?? 1;

    if (shape.type === "pen") {
      const points = shape.points;
      if (points.length >= 2) {
        let pathData = `M ${points[0]} ${points[1]}`;
        for (let i = 2; i < points.length; i += 2) {
          pathData += ` L ${points[i]} ${points[i + 1]}`;
        }
        svgElements.push(
          `<path d="${pathData}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="${opacity}" />`,
        );
      }
    } else if (shape.type === "line") {
      svgElements.push(
        `<line x1="${shape.points[0]}" y1="${shape.points[1]}" x2="${shape.points[2]}" y2="${shape.points[3]}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" opacity="${opacity}" />`,
      );
    } else if (shape.type === "rect") {
      const x = Math.min(shape.points[0], shape.points[2]);
      const y = Math.min(shape.points[1], shape.points[3]);
      const w = Math.abs(shape.points[2] - shape.points[0]);
      const h = Math.abs(shape.points[3] - shape.points[1]);
      svgElements.push(
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" stroke="${color}" stroke-width="${strokeWidth}" fill="none" opacity="${opacity}" />`,
      );
    } else if (shape.type === "circle") {
      const cx = shape.points[0];
      const cy = shape.points[1];
      const ex = shape.points.length >= 4 ? shape.points[2] : cx;
      const ey = shape.points.length >= 4 ? shape.points[3] : cy;
      const rx = Math.abs(ex - cx) || 1;
      const ry = Math.abs(ey - cy) || 1;
      svgElements.push(
        `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" stroke="${color}" stroke-width="${strokeWidth}" fill="none" opacity="${opacity}" />`,
      );
    } else if (shape.type === "sticky") {
      const x = shape.points[0];
      const y = shape.points[1];
      const right = shape.points[2] ?? x + 220;
      const bottom = shape.points[3] ?? y + 160;
      const w = Math.max(160, right - x);
      const h = Math.max(120, bottom - y);

      const lines = (shape.text ?? "Sticky note")
        .replace(/^[#*\-`\s]+/gm, "")
        .split("\n")
        .slice(0, 6);

      const textSpans = lines
        .map(
          (line, index) =>
            `<tspan x="${x + 10}" y="${y + 42 + index * 16}">${escapeXml(line.slice(0, 32))}</tspan>`,
        )
        .join("");

      svgElements.push(`
    <g class="sticky-note" opacity="${opacity}">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" ry="6" fill="#fef08a" stroke="#eab308" stroke-width="1" />
      <path d="M ${x + 6} ${y} L ${x + w - 6} ${y} A 6 6 0 0 1 ${x + w} ${y + 6} L ${x + w} ${y + 24} L ${x} ${y + 24} L ${x} ${y + 6} A 6 6 0 0 1 ${x + 6} ${y} Z" fill="#fde047" />
      <text x="${x + 8}" y="${y + 16}" fill="#854d0e" font-family="sans-serif" font-size="10" font-weight="bold">STICKY NOTE</text>
      <text fill="#1e293b" font-family="sans-serif" font-size="11">${textSpans}</text>
    </g>`);
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="${width}" height="${height}">
  <!-- WorkSphere Transparent Whiteboard Canvas Export -->
  ${svgElements.join("\n  ")}
</svg>`;
}

/**
 * Exports whiteboard shapes to a vector SVG file.
 */
export function exportCanvasAsSvg(
  shapes: ShapeData[],
  options: ExportCanvasOptions = {},
): Blob {
  const filename = options.filename ?? `whiteboard-${Date.now()}.svg`;
  const svgContent = generateSvgString(shapes, options);
  const blob = new Blob([svgContent], {
    type: "image/svg+xml;charset=utf-8",
  });

  if (typeof URL !== "undefined" && typeof document !== "undefined") {
    const url = URL.createObjectURL(blob);
    triggerDownload(url, filename);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return blob;
}
