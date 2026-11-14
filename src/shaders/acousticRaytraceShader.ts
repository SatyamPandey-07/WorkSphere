// Mirror of acoustic_raytrace.wgsl so it can be bundled without a custom loader.
// A test fails if this drifts from the .wgsl file: edit the .wgsl, then copy it here.
export const ACOUSTIC_RAYTRACE_WGSL = `// Real-time acoustic ray tracing. One invocation = one ray.
// Room is an axis aligned box (shoebox) with per-wall materials plus spherical occupants.
// Up to 16 simultaneous emitters. Each invocation picks one source (idx % count), so the
// total ray budget stays constant as sources are added.
// Output 1: absorbed energy per (band, time bin) -> RT60 via backward integration on the CPU side.
// Output 2: path energy density on a coarse grid -> dead zone map.
// Keep the consts below in sync with acousticTypes.ts (a test checks this).

const BAND_COUNT: u32 = 6u;
const TIME_BINS: u32 = 512u;
const GRID_X: u32 = 16u;
const GRID_Y: u32 = 8u;
const GRID_Z: u32 = 16u;
const HUMAN_MATERIAL: u32 = 4u;
const MAX_SOURCES: u32 = 16u;
const PI: f32 = 3.14159265359;
const EPS: f32 = 0.0001;
const FAR: f32 = 1.0e30;

struct Params {
  roomMin: vec3<f32>,
  maxBounces: u32,
  roomMax: vec3<f32>,
  seed: u32,
  source: vec3<f32>,
  occupantCount: u32,
  speedOfSound: f32,
  binDuration: f32,
  rayCount: u32,
  energyScale: f32,
  walls: array<vec4<u32>, 2>, // -x +x -y +y -z +z material ids
  densityScale: f32,
  sourceCount: u32,
}

struct AcousticSource {
  origin: vec4<f32>, // xyz position, w gain
  spectrumLo: vec4<f32>, // bands 0..3
  spectrumHi: vec4<f32>, // bands 4..5, coneCos, outerGain
  direction: vec4<f32>, // xyz cone axis, w unused
}

struct SourceBlock {
  count: u32,
  pad0: u32,
  pad1: u32,
  pad2: u32,
  sources: array<AcousticSource, 16>,
}

struct Material {
  lo: vec4<f32>, // bands 0..3
  hi: vec4<f32>, // bands 4..5 (zw unused)
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> materials: array<Material>;
@group(0) @binding(2) var<storage, read> occupants: array<vec4<f32>>; // xyz center, w radius
@group(0) @binding(3) var<storage, read_write> histogram: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> pathDensity: array<atomic<u32>>;
@group(0) @binding(5) var<uniform> sourceBlock: SourceBlock;

fn pcg(v: u32) -> u32 {
  let state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

fn axis_t(p: f32, d: f32, lo: f32, hi: f32) -> f32 {
  if (d > 1.0e-8) { return max((hi - p) / d, 0.0); }
  if (d < -1.0e-8) { return max((lo - p) / d, 0.0); }
  return FAR;
}

fn band_alpha(m: Material, band: u32) -> f32 {
  if (band < 4u) { return m.lo[band]; }
  return m.hi[band - 4u];
}

fn cell_of(p: vec3<f32>) -> u32 {
  let rel = (p - params.roomMin) / (params.roomMax - params.roomMin);
  let dims = vec3<f32>(f32(GRID_X), f32(GRID_Y), f32(GRID_Z));
  let maxCell = vec3<i32>(i32(GRID_X) - 1, i32(GRID_Y) - 1, i32(GRID_Z) - 1);
  let c = clamp(vec3<i32>(floor(rel * dims)), vec3<i32>(0), maxCell);
  return u32(c.x) + u32(c.y) * GRID_X + u32(c.z) * GRID_X * GRID_Y;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.rayCount) { return; }

  // round-robin over active sources keeps the total ray budget constant
  let sourceCount = max(params.sourceCount, 1u);
  let sourceIndex = idx % sourceCount;
  let source = sourceBlock.sources[sourceIndex];
  let sourceSeed = params.seed ^ (sourceIndex * 0x9e3779b9u);

  // uniform random direction on the unit sphere
  var rng = pcg(idx ^ sourceSeed);
  rng = pcg(rng);
  let u = f32(rng) / 4294967296.0;
  rng = pcg(rng);
  let v = f32(rng) / 4294967296.0;
  let z = 1.0 - 2.0 * u;
  let r = sqrt(max(0.0, 1.0 - z * z));
  let phi = 2.0 * PI * v;
  var dir = vec3<f32>(r * cos(phi), r * sin(phi), z);

  // cone directivity: full energy inside, outerGain outside, soft edge
  let coneCos = source.spectrumHi.z;
  let omni = coneCos <= -1.5;
  let cosTheta = dot(dir, source.direction.xyz);
  let insideCone = smoothstep(coneCos - 0.01, coneCos + 0.01, cosTheta);
  let directivity = select(mix(source.spectrumHi.w, 1.0, insideCone), 1.0, omni);
  let sourceGain = source.origin.w * directivity;

  var pos = source.origin.xyz;
  var dist = 0.0;
  var energy = array<f32, 6>(
    source.spectrumLo.x * sourceGain,
    source.spectrumLo.y * sourceGain,
    source.spectrumLo.z * sourceGain,
    source.spectrumLo.w * sourceGain,
    source.spectrumHi.x * sourceGain,
    source.spectrumHi.y * sourceGain,
  );

  for (var bounce = 0u; bounce < params.maxBounces; bounce = bounce + 1u) {
    // nearest wall
    let tx = axis_t(pos.x, dir.x, params.roomMin.x, params.roomMax.x);
    let ty = axis_t(pos.y, dir.y, params.roomMin.y, params.roomMax.y);
    let tz = axis_t(pos.z, dir.z, params.roomMin.z, params.roomMax.z);
    var tHit = tx;
    var wall = select(0u, 1u, dir.x > 0.0);
    if (ty < tHit) { tHit = ty; wall = 2u + select(0u, 1u, dir.y > 0.0); }
    if (tz < tHit) { tHit = tz; wall = 4u + select(0u, 1u, dir.z > 0.0); }
    var materialId = params.walls[wall / 4u][wall % 4u];
    var normal = vec3<f32>(0.0);
    var hitOccupant = false;

    // occupants (spheres) can be hit before the wall
    for (var i = 0u; i < params.occupantCount; i = i + 1u) {
      let o = occupants[i];
      let oc = pos - o.xyz;
      let b = dot(oc, dir);
      let c = dot(oc, oc) - o.w * o.w;
      let disc = b * b - c;
      if (disc > 0.0) {
        let t = -b - sqrt(disc);
        if (t > EPS && t < tHit) {
          tHit = t;
          hitOccupant = true;
          materialId = HUMAN_MATERIAL;
          normal = normalize(pos + dir * t - o.xyz);
        }
      }
    }

    // path density at the middle of the segment (interior coverage for dead zones)
    var sumE = 0.0;
    for (var band = 0u; band < BAND_COUNT; band = band + 1u) { sumE = sumE + energy[band]; }
    let meanE = sumE / f32(BAND_COUNT);
    atomicAdd(&pathDensity[cell_of(pos + dir * (tHit * 0.5))], u32(meanE * params.densityScale));

    pos = pos + dir * tHit;
    dist = dist + tHit;
    let binF = dist / params.speedOfSound / params.binDuration;
    if (binF >= f32(TIME_BINS)) { break; }
    let bin = u32(binF);

    // absorb per band
    let m = materials[materialId];
    var remaining = 0.0;
    for (var band = 0u; band < BAND_COUNT; band = band + 1u) {
      let absorbed = energy[band] * band_alpha(m, band);
      atomicAdd(&histogram[band * TIME_BINS + bin], u32(absorbed * params.energyScale));
      energy[band] = energy[band] - absorbed;
      remaining = max(remaining, energy[band]);
    }

    // specular reflection
    if (hitOccupant) {
      dir = reflect(dir, normal);
      pos = pos + normal * EPS;
    } else if (wall < 2u) {
      dir.x = -dir.x;
    } else if (wall < 4u) {
      dir.y = -dir.y;
    } else {
      dir.z = -dir.z;
    }

    if (remaining < 0.00001) { break; }
  }
}
`;
