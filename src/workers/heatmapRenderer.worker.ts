/**
 * Offscreen Canvas Crowd Density Heatmap Renderer Worker
 *
 * Accepts a density grid transferred from the main thread via a
 * TransferableMessage and rasterizes it onto an OffscreenCanvas using
 * the 2D Context API. This keeps the main UI thread free during
 * map panning and heatmap updates.
 *
 * Message protocol:
 *   → { type: "INIT", canvas: OffscreenCanvas }
 *   → { type: "RENDER", density: Float32Array, gridW: number, gridH: number,
 *         canvasW: number, canvasH: number }
 *   ← { type: "RENDER_COMPLETE" }
 */

let ctx: OffscreenCanvasRenderingContext2D | null = null;

/** Build a canvas gradient palette from transparent → blue → cyan → green → yellow → red */
function buildPalette(size = 256): Uint32Array {
  const offscreen = new OffscreenCanvas(size, 1);
  const palCtx = offscreen.getContext("2d")!;
  const gradient = palCtx.createLinearGradient(0, 0, size, 0);
  gradient.addColorStop(0,    "rgba(0,0,255,0)");    // transparent
  gradient.addColorStop(0.25, "rgba(0,0,255,0.6)");  // blue
  gradient.addColorStop(0.5,  "rgba(0,255,255,0.7)"); // cyan
  gradient.addColorStop(0.75, "rgba(0,255,0,0.8)");  // green
  gradient.addColorStop(0.9,  "rgba(255,255,0,0.9)"); // yellow
  gradient.addColorStop(1.0,  "rgba(255,0,0,1)");    // red
  palCtx.fillStyle = gradient;
  palCtx.fillRect(0, 0, size, 1);
  const imageData = palCtx.getImageData(0, 0, size, 1);
  return new Uint32Array(imageData.data.buffer);
}

const PALETTE = buildPalette();

function renderHeatmap(
  density: Float32Array,
  gridW: number,
  gridH: number,
  canvasW: number,
  canvasH: number,
): void {
  if (!ctx) return;

  const imageData = ctx.createImageData(canvasW, canvasH);
  const pixels = new Uint32Array(imageData.data.buffer);

  const cellW = canvasW / gridW;
  const cellH = canvasH / gridH;

  // Find max density for normalisation
  let maxDensity = 0;
  for (let i = 0; i < density.length; i++) {
    if (density[i] > maxDensity) maxDensity = density[i];
  }
  if (maxDensity === 0) {
    ctx.clearRect(0, 0, canvasW, canvasH);
    return;
  }

  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const value = density[gy * gridW + gx] / maxDensity; // 0–1
      const paletteIdx = Math.min(
        255,
        Math.floor(value * 255),
      );
      const color = PALETTE[paletteIdx];

      const px0 = Math.floor(gx * cellW);
      const py0 = Math.floor(gy * cellH);
      const px1 = Math.floor((gx + 1) * cellW);
      const py1 = Math.floor((gy + 1) * cellH);

      for (let py = py0; py < py1; py++) {
        for (let px = px0; px < px1; px++) {
          pixels[py * canvasW + px] = color;
        }
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
  self.postMessage({ type: "RENDER_COMPLETE" });
}

self.addEventListener(
  "message",
  (e: MessageEvent<{
    type: string;
    canvas?: OffscreenCanvas;
    density?: Float32Array;
    gridW?: number;
    gridH?: number;
    canvasW?: number;
    canvasH?: number;
  }>) => {
    const { type } = e.data;

    if (type === "INIT" && e.data.canvas) {
      ctx = e.data.canvas.getContext("2d");
      return;
    }

    if (type === "RENDER") {
      const { density, gridW, gridH, canvasW, canvasH } = e.data;
      if (density && gridW && gridH && canvasW && canvasH) {
        renderHeatmap(density, gridW, gridH, canvasW, canvasH);
      }
    }
  },
);
