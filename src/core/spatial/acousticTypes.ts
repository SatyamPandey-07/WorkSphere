export type Vec3 = readonly [number, number, number];

export const BAND_FREQUENCIES_HZ = [125, 250, 500, 1000, 2000, 4000] as const;
export const BAND_COUNT = 6;
export const TIME_BINS = 512;
export const BIN_DURATION_S = 0.004;
export const GRID_DIMS = [16, 8, 16] as const;
export const GRID_CELLS = 16 * 8 * 16;
export const DEFAULT_RAY_COUNT = 64_000;
export const DEFAULT_MAX_BOUNCES = 128;
export const SPEED_OF_SOUND_MS = 343;
export const WORKGROUP_SIZE = 64;
export const MAX_WORKGROUPS_PER_DIM = 65_535;
export const MAX_OCCUPANTS = 64;
/** Keeps the u32 atomic accumulators on the GPU from overflowing. */
export const MAX_RAY_BOUNCE_PRODUCT = 16_000_000;
export const DEAD_ZONE_THRESHOLD = 0.25;

export const AcousticMaterial = {
  Glass: 0,
  Wood: 1,
  Drywall: 2,
  AcousticFoam: 3,
  Human: 4,
} as const;
export type AcousticMaterialId =
  (typeof AcousticMaterial)[keyof typeof AcousticMaterial];

/**
 * Absorption coefficients per octave band (125, 250, 500, 1k, 2k, 4k Hz).
 * Typical handbook values; adjust here if you prefer a different reference.
 */
export const MATERIAL_ABSORPTION: Record<
  AcousticMaterialId,
  readonly number[]
> = {
  0: [0.35, 0.25, 0.18, 0.12, 0.07, 0.04], // glass
  1: [0.15, 0.11, 0.1, 0.07, 0.06, 0.07], // wood
  2: [0.29, 0.1, 0.05, 0.04, 0.07, 0.09], // drywall
  3: [0.11, 0.3, 0.75, 0.95, 0.97, 0.98], // acoustic foam
  4: [0.6, 0.74, 0.88, 0.96, 0.93, 0.85], // human occupants (per m2 of audience)
};

export const MATERIAL_COUNT = 5;

/** 8 floats per material: bands 0..3, then bands 4..5 plus 2 pad (matches WGSL Material). */
export function packMaterialTable(): Float32Array {
  const out = new Float32Array(MATERIAL_COUNT * 8);
  for (let id = 0; id < MATERIAL_COUNT; id++) {
    const a = MATERIAL_ABSORPTION[id as AcousticMaterialId];
    for (let b = 0; b < BAND_COUNT; b++) out[id * 8 + b] = a[b];
  }
  return out;
}

export interface Occupant {
  position: Vec3;
  radius: number;
}

export interface AcousticScene {
  roomMin: Vec3;
  roomMax: Vec3;
  source: Vec3;
  /** Materials for the walls in this order: -x, +x, -y, +y, -z, +z */
  wallMaterials: readonly AcousticMaterialId[];
  occupants?: readonly Occupant[];
}

export interface AcousticOptions {
  rayCount?: number;
  maxBounces?: number;
  seed?: number;
}

export interface RawAcousticOutput {
  /** BAND_COUNT * TIME_BINS absorbed energy per time bin */
  histogram: ArrayLike<number>;
  /** GRID_CELLS path energy density */
  grid: ArrayLike<number>;
}

export interface DeadZoneMap {
  dims: readonly [number, number, number];
  /** Density normalised so the room mean is 1 */
  density: Float32Array;
  deadCells: number[];
  threshold: number;
}

export interface AcousticResult {
  backend: "webgpu" | "cpu";
  rayCount: number;
  maxBounces: number;
  /** Upload + dispatch time, excludes readback. Null on CPU. */
  gpuMs: number | null;
  totalMs: number;
  /** RT60 per octave band in seconds, null when the decay can't be fitted */
  rt60Seconds: (number | null)[];
  deadZones: DeadZoneMap;
}

export function validateAcousticInput(
  scene: AcousticScene,
  rayCount: number,
  maxBounces: number,
): void {
  const maxRays = MAX_WORKGROUPS_PER_DIM * WORKGROUP_SIZE;
  if (!Number.isInteger(rayCount) || rayCount < 1 || rayCount > maxRays) {
    throw new RangeError(
      `rayCount must be an integer between 1 and ${maxRays}`,
    );
  }
  if (!Number.isInteger(maxBounces) || maxBounces < 1) {
    throw new RangeError("maxBounces must be a positive integer");
  }
  if (rayCount * maxBounces > MAX_RAY_BOUNCE_PRODUCT) {
    throw new RangeError(
      `rayCount * maxBounces must be <= ${MAX_RAY_BOUNCE_PRODUCT}`,
    );
  }
  for (let i = 0; i < 3; i++) {
    if (!(scene.roomMax[i] > scene.roomMin[i])) {
      throw new RangeError(
        "roomMax must be greater than roomMin on every axis",
      );
    }
    if (!(
      scene.source[i] >= scene.roomMin[i] && scene.source[i] <= scene.roomMax[i]
    )) {
      throw new RangeError("source must be inside the room");
    }
  }
  if (
    scene.wallMaterials.length !== 6 ||
    scene.wallMaterials.some(
      (m) => !Number.isInteger(m) || m < 0 || m >= MATERIAL_COUNT,
    )
  ) {
    throw new RangeError("wallMaterials needs 6 valid material ids");
  }
  const occ = scene.occupants ?? [];
  if (occ.length > MAX_OCCUPANTS) {
    throw new RangeError(`at most ${MAX_OCCUPANTS} occupants are supported`);
  }
  if (occ.some((o) => !(o.radius > 0))) {
    throw new RangeError("occupant radius must be positive");
  }
}

function fitDecay(
  edcDb: Float64Array,
  hiDb: number,
  loDb: number,
  dt: number,
): number | null {
  let start = -1;
  let end = -1;
  for (let i = 0; i < edcDb.length; i++) {
    if (start < 0 && edcDb[i] <= hiDb) start = i;
    if (edcDb[i] <= loDb) {
      end = Number.isFinite(edcDb[i]) ? i : i - 1;
      break;
    }
  }
  if (start < 0 || end - start < 3) return null;
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = start; i <= end; i++) {
    const x = i * dt;
    const y = edcDb[i];
    n++;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const slope = (n * sxy - sx * sy) / denom; // dB per second
  if (slope >= 0) return null;
  return -60 / slope;
}

/**
 * RT60 from the energy decay curve. EDC(t) is the energy absorbed after t,
 * which is the Schroeder backward integral for a ray histogram.
 * Fits T30 (-5 to -35 dB), falls back to T20 (-5 to -25 dB).
 */
export function estimateRt60(
  histogram: ArrayLike<number>,
  bandIndex: number,
  binDuration: number = BIN_DURATION_S,
): number | null {
  const base = bandIndex * TIME_BINS;
  const edc = new Float64Array(TIME_BINS);
  let acc = 0;
  for (let i = TIME_BINS - 1; i >= 0; i--) {
    acc += histogram[base + i];
    edc[i] = acc;
  }
  const total = edc[0];
  if (!(total > 0)) return null;
  const db = new Float64Array(TIME_BINS);
  for (let i = 0; i < TIME_BINS; i++) {
    db[i] = edc[i] > 0 ? 10 * Math.log10(edc[i] / total) : -Infinity;
  }
  return (
    fitDecay(db, -5, -35, binDuration) ?? fitDecay(db, -5, -25, binDuration)
  );
}

export function buildDeadZoneMap(
  grid: ArrayLike<number>,
  threshold = DEAD_ZONE_THRESHOLD,
): DeadZoneMap {
  let sum = 0;
  for (let i = 0; i < GRID_CELLS; i++) sum += grid[i];
  const density = new Float32Array(GRID_CELLS);
  const deadCells: number[] = [];
  if (sum > 0) {
    const mean = sum / GRID_CELLS;
    for (let i = 0; i < GRID_CELLS; i++) {
      density[i] = grid[i] / mean;
      if (density[i] < threshold) deadCells.push(i);
    }
  }
  return { dims: GRID_DIMS, density, deadCells, threshold };
}

export function analyzeAcousticOutput(raw: RawAcousticOutput): {
  rt60Seconds: (number | null)[];
  deadZones: DeadZoneMap;
} {
  const rt60Seconds: (number | null)[] = [];
  for (let b = 0; b < BAND_COUNT; b++) {
    rt60Seconds.push(estimateRt60(raw.histogram, b));
  }
  return { rt60Seconds, deadZones: buildDeadZoneMap(raw.grid) };
}
