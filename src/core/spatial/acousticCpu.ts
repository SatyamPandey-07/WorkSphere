import {
  BAND_COUNT,
  BIN_DURATION_S,
  DEFAULT_MAX_BOUNCES,
  DEFAULT_RAY_COUNT,
  GRID_CELLS,
  GRID_DIMS,
  MATERIAL_ABSORPTION,
  SPEED_OF_SOUND_MS,
  TIME_BINS,
  resolveAcousticSources,
  type AcousticMaterialId,
  type AcousticOptions,
  type AcousticScene,
  type ResolvedAcousticSource,
} from "./acousticTypes";

const HUMAN = 4;
const EPS = 1e-4;
const FAR = 1e30;

function pcg(v: number): number {
  const s = (Math.imul(v, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}

function axisT(p: number, d: number, lo: number, hi: number): number {
  if (d > 1e-8) return Math.max((hi - p) / d, 0);
  if (d < -1e-8) return Math.max((lo - p) / d, 0);
  return FAR;
}

/**
 * Same cone model as the WGSL shader: energy is fully weighted inside the
 * cone, falls smoothly across a narrow band at the edge, and uses `outerGain`
 * outside.
 */
function sourceDirectivity(
  source: ResolvedAcousticSource,
  dx: number,
  dy: number,
  dz: number,
): number {
  if (source.coneCos <= -1.5) return 1; // omnidirectional sentinel
  const cosTheta =
    dx * source.direction[0] +
    dy * source.direction[1] +
    dz * source.direction[2];
  const edge0 = source.coneCos - 0.01;
  const edge1 = source.coneCos + 0.01;
  const t = Math.min(1, Math.max(0, (cosTheta - edge0) / (edge1 - edge0)));
  const inside = t * t * (3 - 2 * t);
  return source.outerGain + (1 - source.outerGain) * inside;
}

/** Same algorithm as acoustic_raytrace.wgsl, single threaded. Runs inside a worker. */
export function simulateAcousticsCpu(
  scene: AcousticScene,
  options: AcousticOptions = {},
): { histogram: Float64Array; grid: Float64Array } {
  const rayCount = options.rayCount ?? DEFAULT_RAY_COUNT;
  const maxBounces = options.maxBounces ?? DEFAULT_MAX_BOUNCES;
  const seed = (options.seed ?? 0x9e3779b9) >>> 0;
  const [minX, minY, minZ] = scene.roomMin;
  const [maxX, maxY, maxZ] = scene.roomMax;
  const occupants = scene.occupants ?? [];
  const sources = resolveAcousticSources(scene);
  const histogram = new Float64Array(BAND_COUNT * TIME_BINS);
  const grid = new Float64Array(GRID_CELLS);
  const energy = new Float64Array(BAND_COUNT);

  const cellOf = (x: number, y: number, z: number): number => {
    const cx = Math.min(
      GRID_DIMS[0] - 1,
      Math.max(0, Math.floor(((x - minX) / (maxX - minX)) * GRID_DIMS[0])),
    );
    const cy = Math.min(
      GRID_DIMS[1] - 1,
      Math.max(0, Math.floor(((y - minY) / (maxY - minY)) * GRID_DIMS[1])),
    );
    const cz = Math.min(
      GRID_DIMS[2] - 1,
      Math.max(0, Math.floor(((z - minZ) / (maxZ - minZ)) * GRID_DIMS[2])),
    );
    return cx + cy * GRID_DIMS[0] + cz * GRID_DIMS[0] * GRID_DIMS[1];
  };

  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
    const source = sources[sourceIndex];
    const [sourceX, sourceY, sourceZ] = source.position;
    const sourceSeed = (seed ^ Math.imul(sourceIndex, 0x9e3779b9)) >>> 0;

    for (let idx = 0; idx < rayCount; idx++) {
      let rng = pcg((idx ^ sourceSeed) >>> 0);
      rng = pcg(rng);
      const u = rng / 4294967296;
      rng = pcg(rng);
      const v = rng / 4294967296;
      const zc = 1 - 2 * u;
      const rr = Math.sqrt(Math.max(0, 1 - zc * zc));
      const phi = 2 * Math.PI * v;
      let dx = rr * Math.cos(phi);
      let dy = rr * Math.sin(phi);
      let dz = zc;
      const directivity = sourceDirectivity(source, dx, dy, dz);
      for (let band = 0; band < BAND_COUNT; band++) {
        energy[band] = source.spectrum[band] * source.gain * directivity;
      }
      let px = sourceX;
      let py = sourceY;
      let pz = sourceZ;
      let dist = 0;

      for (let bounce = 0; bounce < maxBounces; bounce++) {
        const tx = axisT(px, dx, minX, maxX);
        const ty = axisT(py, dy, minY, maxY);
        const tz = axisT(pz, dz, minZ, maxZ);
        let tHit = tx;
        let wall = dx > 0 ? 1 : 0;
        if (ty < tHit) {
          tHit = ty;
          wall = 2 + (dy > 0 ? 1 : 0);
        }
        if (tz < tHit) {
          tHit = tz;
          wall = 4 + (dz > 0 ? 1 : 0);
        }
        let materialId: number = scene.wallMaterials[wall];
        let hitOccupant = false;
        let nx = 0;
        let ny = 0;
        let nz = 0;

        for (const o of occupants) {
          const ocx = px - o.position[0];
          const ocy = py - o.position[1];
          const ocz = pz - o.position[2];
          const b = ocx * dx + ocy * dy + ocz * dz;
          const c = ocx * ocx + ocy * ocy + ocz * ocz - o.radius * o.radius;
          const disc = b * b - c;
          if (disc > 0) {
            const t = -b - Math.sqrt(disc);
            if (t > EPS && t < tHit) {
              tHit = t;
              hitOccupant = true;
              materialId = HUMAN;
              nx = px + dx * t - o.position[0];
              ny = py + dy * t - o.position[1];
              nz = pz + dz * t - o.position[2];
              const len = Math.hypot(nx, ny, nz) || 1;
              nx /= len;
              ny /= len;
              nz /= len;
            }
          }
        }

        let sumE = 0;
        for (let band = 0; band < BAND_COUNT; band++) sumE += energy[band];
        grid[
          cellOf(
            px + dx * tHit * 0.5,
            py + dy * tHit * 0.5,
            pz + dz * tHit * 0.5,
          )
        ] += sumE / BAND_COUNT;

        px += dx * tHit;
        py += dy * tHit;
        pz += dz * tHit;
        dist += tHit;
        const binF = dist / SPEED_OF_SOUND_MS / BIN_DURATION_S;
        if (binF >= TIME_BINS) break;
        const bin = Math.floor(binF);

        const alpha = MATERIAL_ABSORPTION[materialId as AcousticMaterialId];
        let remaining = 0;
        for (let band = 0; band < BAND_COUNT; band++) {
          const absorbed = energy[band] * alpha[band];
          histogram[band * TIME_BINS + bin] += absorbed;
          energy[band] -= absorbed;
          if (energy[band] > remaining) remaining = energy[band];
        }

        if (hitOccupant) {
          const dn = dx * nx + dy * ny + dz * nz;
          dx -= 2 * dn * nx;
          dy -= 2 * dn * ny;
          dz -= 2 * dn * nz;
          px += nx * EPS;
          py += ny * EPS;
          pz += nz * EPS;
        } else if (wall < 2) dx = -dx;
        else if (wall < 4) dy = -dy;
        else dz = -dz;

        if (remaining < 1e-5) break;
      }
    }
  }
  return { histogram, grid };
}
