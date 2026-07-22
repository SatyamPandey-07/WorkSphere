/**
 * Pure 2D heat-equation helpers (shared by WebGPU path + WebGL fallback + tests).
 */

export type HvacSensor = {
  /** Grid column */
  x: number;
  /** Grid row */
  y: number;
  /** Celsius */
  temperature: number;
};

export type HeatGridConfig = {
  width: number;
  height: number;
  /** Thermal diffusivity coefficient */
  alpha?: number;
  dt?: number;
  ambient?: number;
  sensors?: HvacSensor[];
};

export type HeatDiffusionConfig = HeatGridConfig & {
  minTemp?: number;
  maxTemp?: number;
  opacity?: number;
};

export const DEFAULT_HEAT_GRID = {
  width: 64,
  height: 64,
  alpha: 0.15,
  dt: 1,
  ambient: 22,
} as const;

/**
 * One explicit Jacobi / finite-difference step of the 2D heat equation,
 * then re-inject HVAC sensor temperatures.
 */
export function stepHeatDiffusion(
  input: Float32Array,
  output: Float32Array,
  config: Required<
    Pick<HeatGridConfig, "width" | "height" | "alpha" | "dt" | "ambient">
  > & { sensors: HvacSensor[] },
): void {
  const { width: w, height: h, alpha, dt, ambient, sensors } = config;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const xl = x === 0 ? x : x - 1;
      const xr = x + 1 >= w ? x : x + 1;
      const yd = y === 0 ? y : y - 1;
      const yu = y + 1 >= h ? y : y + 1;

      const c = input[idx];
      const lap =
        input[y * w + xl] +
        input[y * w + xr] +
        input[yd * w + x] +
        input[yu * w + x] -
        4 * c;

      let next = c + alpha * dt * lap;
      next = next + (ambient - next) * 0.002;
      output[idx] = next;
    }
  }

  for (const s of sensors) {
    if (s.x < 0 || s.y < 0 || s.x >= w || s.y >= h) continue;
    output[s.y * w + s.x] = s.temperature;
  }
}

export function createAmbientGrid(
  width: number,
  height: number,
  ambient: number,
  sensors: HvacSensor[] = [],
): Float32Array {
  const grid = new Float32Array(width * height).fill(ambient);
  for (const s of sensors) {
    if (s.x < 0 || s.y < 0 || s.x >= width || s.y >= height) continue;
    grid[s.y * width + s.x] = s.temperature;
  }
  return grid;
}

/** Map Celsius → RGBA heatmap (matches WGSL/GLSL ramp). */
export function temperatureToRgba(
  temp: number,
  minTemp: number,
  maxTemp: number,
  opacity = 0.75,
): [number, number, number, number] {
  const span = Math.max(maxTemp - minTemp, 0.001);
  const t = Math.min(1, Math.max(0, (temp - minTemp) / span));
  let r: number;
  let g: number;
  let b: number;
  if (t < 0.25) {
    const k = t / 0.25;
    r = 0.05 + (0.0 - 0.05) * k;
    g = 0.15 + (0.75 - 0.15) * k;
    b = 0.55 + (1.0 - 0.55) * k;
  } else if (t < 0.5) {
    const k = (t - 0.25) / 0.25;
    r = 0.0 + (0.15 - 0.0) * k;
    g = 0.75 + (0.9 - 0.75) * k;
    b = 1.0 + (0.35 - 1.0) * k;
  } else if (t < 0.75) {
    const k = (t - 0.5) / 0.25;
    r = 0.15 + (1.0 - 0.15) * k;
    g = 0.9 + (0.85 - 0.9) * k;
    b = 0.35 + (0.1 - 0.35) * k;
  } else {
    const k = (t - 0.75) / 0.25;
    r = 1.0 + (0.95 - 1.0) * k;
    g = 0.85 + (0.1 - 0.85) * k;
    b = 0.1 + (0.12 - 0.1) * k;
  }
  return [r, g, b, opacity];
}
