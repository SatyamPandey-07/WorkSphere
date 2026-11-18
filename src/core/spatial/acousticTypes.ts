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
/** Maximum number of simultaneous emitters supported by the shader. */
export const MAX_ACOUSTIC_SOURCES = 16;
/** Per-source uniform block: 4 vec4s (position/gain, spectrum, cone, direction). */
export const SOURCE_STRIDE_FLOATS = 16;
export const SOURCE_BLOCK_HEADER_FLOATS = 4;
export const SOURCE_BLOCK_FLOATS =
  SOURCE_BLOCK_HEADER_FLOATS + MAX_ACOUSTIC_SOURCES * SOURCE_STRIDE_FLOATS;
export const SOURCE_BLOCK_BYTES = SOURCE_BLOCK_FLOATS * 4;
/** Bounds keep GPU accumulators finite and the CPU path numerically stable. */
export const MAX_SOURCE_SPECTRUM = 64;
export const MAX_SOURCE_GAIN = 16;
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

/**
 * One acoustic emitter. `position` is required; everything else has a
 * backwards-compatible omnidirectional default.
 */
export interface AcousticSource {
  position: Vec3;
  /** Linear energy per octave band (125, 250, 500, 1k, 2k, 4k Hz). */
  spectrum?: readonly number[];
  /** Cone axis; normalized internally. Defaults to +z (irrelevant when omni). */
  direction?: Vec3;
  /** Half-angle of the directivity cone in radians. Defaults to PI (omni). */
  coneAngle?: number;
  /** Energy multiplier outside the cone, 0..1. Defaults to 0 for cones, 1 for omni. */
  outerGain?: number;
  /** Overall linear source gain. Defaults to 1. */
  gain?: number;
}

export interface ResolvedAcousticSource {
  position: Vec3;
  spectrum: readonly number[];
  direction: Vec3;
  coneAngle: number;
  /** Cosine of the cone half-angle; -2 marks an omnidirectional source. */
  coneCos: number;
  outerGain: number;
  gain: number;
}

export const DEFAULT_SOURCE_SPECTRUM: readonly number[] = [1, 1, 1, 1, 1, 1];

function normalizeDirection(value: Vec3): Vec3 {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (!Number.isFinite(length) || length <= 1e-9) return [0, 0, 1];
  return [value[0] / length, value[1] / length, value[2] / length];
}

/**
 * Resolves `scene.sources` (or the legacy single `scene.source`) into the
 * normalized list used by both the GPU shader and the CPU fallback.
 */
export function resolveAcousticSources(
  scene: AcousticScene,
): ResolvedAcousticSource[] {
  const raw: readonly AcousticSource[] =
    scene.sources && scene.sources.length > 0
      ? scene.sources
      : [{ position: scene.source }];

  return raw.slice(0, MAX_ACOUSTIC_SOURCES).map((source) => {
    const spectrum =
      source.spectrum && source.spectrum.length === BAND_COUNT
        ? source.spectrum
        : DEFAULT_SOURCE_SPECTRUM;
    const coneAngle = source.coneAngle ?? Math.PI;
    const omni = coneAngle >= Math.PI - 1e-6;
    return {
      position: source.position,
      spectrum,
      direction: normalizeDirection(source.direction ?? [0, 0, 1]),
      coneAngle,
      coneCos: omni ? -2 : Math.cos(coneAngle),
      outerGain: source.outerGain ?? (omni ? 1 : 0),
      gain: source.gain ?? 1,
    };
  });
}

/**
 * Packs the active sources into the WGSL uniform block:
 * `vec4 count/padding` followed by 16 × 4 vec4 entries.
 */
export function packSourceBlock(
  sources: readonly ResolvedAcousticSource[],
): ArrayBuffer {
  const buffer = new ArrayBuffer(SOURCE_BLOCK_BYTES);
  const header = new Uint32Array(buffer, 0, SOURCE_BLOCK_HEADER_FLOATS);
  header[0] = Math.min(sources.length, MAX_ACOUSTIC_SOURCES);

  const f32 = new Float32Array(buffer);
  sources.slice(0, MAX_ACOUSTIC_SOURCES).forEach((source, index) => {
    const base = SOURCE_BLOCK_HEADER_FLOATS + index * SOURCE_STRIDE_FLOATS;
    f32[base] = source.position[0];
    f32[base + 1] = source.position[1];
    f32[base + 2] = source.position[2];
    f32[base + 3] = source.gain;
    f32[base + 4] = source.spectrum[0];
    f32[base + 5] = source.spectrum[1];
    f32[base + 6] = source.spectrum[2];
    f32[base + 7] = source.spectrum[3];
    f32[base + 8] = source.spectrum[4];
    f32[base + 9] = source.spectrum[5];
    f32[base + 10] = source.coneCos;
    f32[base + 11] = source.outerGain;
    f32[base + 12] = source.direction[0];
    f32[base + 13] = source.direction[1];
    f32[base + 14] = source.direction[2];
    f32[base + 15] = 0;
  });

  return buffer;
}

/** Triangle mesh primitive used by the venue acoustic ray tracer. */
export interface AcousticTriangle {
  a: Vec3;
  b: Vec3;
  c: Vec3;
  materialId: AcousticMaterialId;
}
export interface FlatAcousticBvhNode {
  boundsMin: Vec3;
  boundsMax: Vec3;
  firstTriangle: number;
  triangleCount: number;
  escapeIndex: number;
}
export interface AcousticBvh {
  nodes: FlatAcousticBvhNode[];
  triangles: AcousticTriangle[];
}
export interface AcousticTriangleHit {
  distance: number;
  normal: Vec3;
  materialId: AcousticMaterialId;
}
export const MAX_ACOUSTIC_TRIANGLES = 32_768;
export const MAX_ACOUSTIC_BVH_NODES = MAX_ACOUSTIC_TRIANGLES * 2 - 1;
export const ACOUSTIC_BVH_NODE_BYTES = 48;
export const ACOUSTIC_TRIANGLE_BYTES = 64;
export const ACOUSTIC_BVH_LEAF_SIZE = 4;

/** Slab test; returns the closest non-negative entry distance or null on a miss. */
export function intersectRayAabb(
  origin: Vec3,
  direction: Vec3,
  boundsMin: Vec3,
  boundsMax: Vec3,
  maxDistance = Number.POSITIVE_INFINITY,
): number | null {
  let near = 0;
  let far = maxDistance;
  for (let axis = 0; axis < 3; axis++) {
    const o = origin[axis];
    const d = direction[axis];
    if (Math.abs(d) < 1e-8) {
      if (o < boundsMin[axis] || o > boundsMax[axis]) return null;
      continue;
    }
    const inv = 1 / d;
    let t1 = (boundsMin[axis] - o) * inv;
    let t2 = (boundsMax[axis] - o) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    near = Math.max(near, t1);
    far = Math.min(far, t2);
    if (far < near) return null;
  }
  return far >= 0 && near <= maxDistance ? near : null;
}

/** Möller–Trumbore ray/triangle test; returned normal faces against the ray. */
export function intersectRayTriangle(
  origin: Vec3,
  direction: Vec3,
  triangle: AcousticTriangle,
  maxDistance = Number.POSITIVE_INFINITY,
): AcousticTriangleHit | null {
  const e1: Vec3 = [
    triangle.b[0] - triangle.a[0],
    triangle.b[1] - triangle.a[1],
    triangle.b[2] - triangle.a[2],
  ];
  const e2: Vec3 = [
    triangle.c[0] - triangle.a[0],
    triangle.c[1] - triangle.a[1],
    triangle.c[2] - triangle.a[2],
  ];
  const p = [
    direction[1] * e2[2] - direction[2] * e2[1],
    direction[2] * e2[0] - direction[0] * e2[2],
    direction[0] * e2[1] - direction[1] * e2[0],
  ];
  const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
  if (Math.abs(det) < 1e-8) return null;
  const invDet = 1 / det;
  const tVec = [
    origin[0] - triangle.a[0],
    origin[1] - triangle.a[1],
    origin[2] - triangle.a[2],
  ];
  const u = (tVec[0] * p[0] + tVec[1] * p[1] + tVec[2] * p[2]) * invDet;
  if (u < 0 || u > 1) return null;
  const q = [
    tVec[1] * e1[2] - tVec[2] * e1[1],
    tVec[2] * e1[0] - tVec[0] * e1[2],
    tVec[0] * e1[1] - tVec[1] * e1[0],
  ];
  const v = (direction[0] * q[0] + direction[1] * q[1] + direction[2] * q[2]) * invDet;
  if (v < 0 || u + v > 1) return null;
  const distance = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * invDet;
  if (distance <= 1e-4 || distance >= maxDistance) return null;

  let nx = e1[1] * e2[2] - e1[2] * e2[1];
  let ny = e1[2] * e2[0] - e1[0] * e2[2];
  let nz = e1[0] * e2[1] - e1[1] * e2[0];
  const length = Math.hypot(nx, ny, nz);
  if (length <= 1e-12) return null;
  nx /= length; ny /= length; nz /= length;
  if (nx * direction[0] + ny * direction[1] + nz * direction[2] > 0) {
    nx = -nx; ny = -ny; nz = -nz;
  }
  return { distance, normal: [nx, ny, nz], materialId: triangle.materialId };
}

/** Build a median-split depth-first BVH. Each node stores its subtree escape index. */
export function buildAcousticBvh(
  triangles: readonly AcousticTriangle[],
  leafSize = ACOUSTIC_BVH_LEAF_SIZE,
): AcousticBvh {
  if (!Number.isInteger(leafSize) || leafSize < 1) {
    throw new RangeError("BVH leafSize must be a positive integer");
  }
  if (triangles.length > MAX_ACOUSTIC_TRIANGLES) {
    throw new RangeError(`at most ${MAX_ACOUSTIC_TRIANGLES} triangles are supported`);
  }
  const nodes: FlatAcousticBvhNode[] = [];
  const ordered: AcousticTriangle[] = [];
  if (triangles.length === 0) return { nodes, triangles: ordered };
  const centroid = (t: AcousticTriangle, axis: number) =>
    (t.a[axis] + t.b[axis] + t.c[axis]) / 3;

  const build = (indices: number[]): void => {
    const nodeIndex = nodes.length;
    nodes.push({
      boundsMin: [Infinity, Infinity, Infinity],
      boundsMax: [-Infinity, -Infinity, -Infinity],
      firstTriangle: 0,
      triangleCount: 0,
      escapeIndex: 0,
    });
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    const cLo = [Infinity, Infinity, Infinity];
    const cHi = [-Infinity, -Infinity, -Infinity];
    for (const index of indices) {
      const t = triangles[index];
      for (const vertex of [t.a, t.b, t.c]) {
        for (let axis = 0; axis < 3; axis++) {
          lo[axis] = Math.min(lo[axis], vertex[axis]);
          hi[axis] = Math.max(hi[axis], vertex[axis]);
        }
      }
      for (let axis = 0; axis < 3; axis++) {
        const c = centroid(t, axis);
        cLo[axis] = Math.min(cLo[axis], c);
        cHi[axis] = Math.max(cHi[axis], c);
      }
    }
    const boundsMin = lo as unknown as Vec3;
    const boundsMax = hi as unknown as Vec3;
    if (indices.length <= leafSize) {
      const firstTriangle = ordered.length;
      indices.forEach((index) => ordered.push(triangles[index]));
      nodes[nodeIndex] = {
        boundsMin, boundsMax, firstTriangle,
        triangleCount: indices.length, escapeIndex: nodes.length,
      };
      return;
    }
    let axis = 0;
    for (let candidate = 1; candidate < 3; candidate++) {
      if (cHi[candidate] - cLo[candidate] > cHi[axis] - cLo[axis]) axis = candidate;
    }
    const sorted = [...indices].sort(
      (a, b) => centroid(triangles[a], axis) - centroid(triangles[b], axis) || a - b,
    );
    const middle = Math.floor(sorted.length / 2);
    build(sorted.slice(0, middle));
    build(sorted.slice(middle));
    nodes[nodeIndex] = {
      boundsMin, boundsMax, firstTriangle: 0,
      triangleCount: 0, escapeIndex: nodes.length,
    };
  };
  build(triangles.map((_, index) => index));
  return { nodes, triangles: ordered };
}

/** Stackless traversal jumps over a missed subtree using its escape index. */
export function findNearestBvhTriangleHit(
  bvh: AcousticBvh,
  origin: Vec3,
  direction: Vec3,
  maxDistance = Number.POSITIVE_INFINITY,
): AcousticTriangleHit | null {
  let result: AcousticTriangleHit | null = null;
  let nearest = maxDistance;
  let nodeIndex = 0;
  let visits = 0;
  while (nodeIndex < bvh.nodes.length && visits++ < bvh.nodes.length) {
    const node = bvh.nodes[nodeIndex];
    const entry = intersectRayAabb(origin, direction, node.boundsMin, node.boundsMax, nearest);
    if (entry === null) {
      nodeIndex = node.escapeIndex;
      continue;
    }
    if (node.triangleCount === 0) {
      nodeIndex++;
      continue;
    }
    for (let i = 0; i < node.triangleCount; i++) {
      const hit = intersectRayTriangle(origin, direction, bvh.triangles[node.firstTriangle + i], nearest);
      if (hit) { result = hit; nearest = hit.distance; }
    }
    nodeIndex = node.escapeIndex;
  }
  return result;
}

/** Linear reference kept for correctness comparisons and benchmark baselines. */
export function findNearestLinearTriangleHit(
  triangles: readonly AcousticTriangle[],
  origin: Vec3,
  direction: Vec3,
  maxDistance = Number.POSITIVE_INFINITY,
): AcousticTriangleHit | null {
  let result: AcousticTriangleHit | null = null;
  let nearest = maxDistance;
  for (const triangle of triangles) {
    const hit = intersectRayTriangle(origin, direction, triangle, nearest);
    if (hit) { result = hit; nearest = hit.distance; }
  }
  return result;
}

/** WGSL storage format: BVH nodes are 48 bytes and triangles are 64 bytes. */
export function packAcousticBvh(bvh: AcousticBvh): {
  nodeBuffer: ArrayBuffer;
  triangleBuffer: ArrayBuffer;
} {
  const nodeBuffer = new ArrayBuffer(Math.max(1, bvh.nodes.length) * ACOUSTIC_BVH_NODE_BYTES);
  const floats = new Float32Array(nodeBuffer);
  const ints = new Uint32Array(nodeBuffer);
  bvh.nodes.forEach((node, i) => {
    const base = i * 12;
    floats.set([...node.boundsMin, 0], base);
    floats.set([...node.boundsMax, 0], base + 4);
    ints[base + 8] = node.firstTriangle;
    ints[base + 9] = node.triangleCount;
    ints[base + 10] = node.escapeIndex;
  });
  const triangleBuffer = new ArrayBuffer(Math.max(1, bvh.triangles.length) * ACOUSTIC_TRIANGLE_BYTES);
  const triangleFloats = new Float32Array(triangleBuffer);
  const triangleInts = new Uint32Array(triangleBuffer);
  bvh.triangles.forEach((triangle, i) => {
    const base = i * 16;
    triangleFloats.set([...triangle.a, 0], base);
    triangleFloats.set([...triangle.b, 0], base + 4);
    triangleFloats.set([...triangle.c, 0], base + 8);
    triangleInts[base + 12] = triangle.materialId;
  });
  return { nodeBuffer, triangleBuffer };
}

export interface AcousticScene {
  roomMin: Vec3;
  roomMax: Vec3;
  /** Legacy primary source, used when `sources` is absent/empty. */
  source: Vec3;
  /** Up to MAX_ACOUSTIC_SOURCES simultaneous emitters. */
  sources?: readonly AcousticSource[];
  /** Materials for the walls in this order: -x, +x, -y, +y, -z, +z */
  wallMaterials: readonly AcousticMaterialId[];
  occupants?: readonly Occupant[];
  /** Optional polygonal venue mesh; room walls remain the enclosing fallback. */
  triangles?: readonly AcousticTriangle[];
}

export interface AcousticOptions {
  rayCount?: number;
  maxBounces?: number;
  seed?: number;
  /** Disable BVH only for benchmark baselines; accelerated traversal is the default. */
  useBvh?: boolean;
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
  /** Number of active emitters aggregated into this result. */
  sourceCount: number;
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
  }
  if (scene.sources && scene.sources.length > MAX_ACOUSTIC_SOURCES) {
    throw new RangeError(
      `at most ${MAX_ACOUSTIC_SOURCES} acoustic sources are supported`,
    );
  }
  for (const source of scene.sources ?? []) {
    if (source.spectrum) {
      if (
        source.spectrum.length !== BAND_COUNT ||
        source.spectrum.some(
          (value) =>
            !Number.isFinite(value) || value < 0 || value > MAX_SOURCE_SPECTRUM,
        )
      ) {
        throw new RangeError(
          `source spectrum needs ${BAND_COUNT} values between 0 and ${MAX_SOURCE_SPECTRUM}`,
        );
      }
    }
    if (
      source.gain !== undefined &&
      (!Number.isFinite(source.gain) ||
        source.gain <= 0 ||
        source.gain > MAX_SOURCE_GAIN)
    ) {
      throw new RangeError(
        `source gain must be greater than 0 and at most ${MAX_SOURCE_GAIN}`,
      );
    }
    if (
      source.outerGain !== undefined &&
      (!Number.isFinite(source.outerGain) ||
        source.outerGain < 0 ||
        source.outerGain > 1)
    ) {
      throw new RangeError("source outerGain must be between 0 and 1");
    }
    if (
      source.coneAngle !== undefined &&
      (!Number.isFinite(source.coneAngle) ||
        source.coneAngle <= 0 ||
        source.coneAngle > Math.PI)
    ) {
      throw new RangeError("source coneAngle must be between 0 and PI");
    }
    if (source.direction) {
      const length = Math.hypot(
        source.direction[0],
        source.direction[1],
        source.direction[2],
      );
      if (!Number.isFinite(length) || length <= 1e-9) {
        throw new RangeError("source direction must be a non-zero vector");
      }
    }
  }

  const sources = resolveAcousticSources(scene);
  if (rayCount < sources.length) {
    throw new RangeError(
      "rayCount must be at least the number of active sources",
    );
  }
  for (const source of sources) {
    for (let i = 0; i < 3; i++) {
      if (!(
        source.position[i] >= scene.roomMin[i] &&
        source.position[i] <= scene.roomMax[i]
      )) {
        throw new RangeError("every source must be inside the room");
      }
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
  const triangles = scene.triangles ?? [];
  if (triangles.length > MAX_ACOUSTIC_TRIANGLES) {
    throw new RangeError(`at most ${MAX_ACOUSTIC_TRIANGLES} acoustic triangles are supported`);
  }
  for (const triangle of triangles) {
    const vertices = [triangle.a, triangle.b, triangle.c];
    if (
      vertices.some((vertex) => vertex.some((value) => !Number.isFinite(value))) ||
      !Number.isInteger(triangle.materialId) ||
      triangle.materialId < 0 ||
      triangle.materialId >= MATERIAL_COUNT
    ) {
      throw new RangeError("each acoustic triangle needs finite vertices and a valid material id");
    }
    const e1 = [triangle.b[0] - triangle.a[0], triangle.b[1] - triangle.a[1], triangle.b[2] - triangle.a[2]];
    const e2 = [triangle.c[0] - triangle.a[0], triangle.c[1] - triangle.a[1], triangle.c[2] - triangle.a[2]];
    const area2 = Math.hypot(
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    );
    if (area2 <= 1e-9) throw new RangeError("acoustic triangles must have non-zero area");
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
