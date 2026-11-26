// Real-time acoustic ray tracing. One invocation = one ray.
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
  bvhNodeCount: u32,
  triangleCount: u32,
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

struct BvhNode {
  boundsMin: vec4<f32>,
  boundsMax: vec4<f32>,
  meta: vec4<u32>, // first triangle, triangle count, escape node, padding
}

struct MeshTriangle {
  a: vec4<f32>,
  b: vec4<f32>,
  c: vec4<f32>,
  meta: vec4<u32>, // material id, padding
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
@group(0) @binding(6) var<storage, read> bvhNodes: array<BvhNode>;
@group(0) @binding(7) var<storage, read> meshTriangles: array<MeshTriangle>;

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
struct TriangleHit {
  distance: f32,
  normal: vec3<f32>,
  materialId: u32,
  hit: bool,
}

fn ray_box_distance(
  origin: vec3<f32>,
  direction: vec3<f32>,
  boundsMin: vec3<f32>,
  boundsMax: vec3<f32>,
  maxDistance: f32,
) -> f32 {
  var near = 0.0;
  var far = maxDistance;
  for (var axis = 0u; axis < 3u; axis = axis + 1u) {
    let o = origin[axis];
    let d = direction[axis];
    if (abs(d) < 1.0e-8) {
      if (o < boundsMin[axis] || o > boundsMax[axis]) { return FAR; }
    } else {
      let inv = 1.0 / d;
      var t1 = (boundsMin[axis] - o) * inv;
      var t2 = (boundsMax[axis] - o) * inv;
      if (t1 > t2) { let temp = t1; t1 = t2; t2 = temp; }
      near = max(near, t1);
      far = min(far, t2);
      if (far < near) { return FAR; }
    }
  }
  if (far < 0.0 || near > maxDistance) { return FAR; }
  return near;
}

fn intersect_mesh_triangle(
  origin: vec3<f32>,
  direction: vec3<f32>,
  triangle: MeshTriangle,
  maxDistance: f32,
) -> TriangleHit {
  let e1 = triangle.b.xyz - triangle.a.xyz;
  let e2 = triangle.c.xyz - triangle.a.xyz;
  let p = cross(direction, e2);
  let det = dot(e1, p);
  if (abs(det) < 1.0e-8) {
    return TriangleHit(FAR, vec3<f32>(0.0), 0u, false);
  }
  let invDet = 1.0 / det;
  let tVec = origin - triangle.a.xyz;
  let u = dot(tVec, p) * invDet;
  if (u < 0.0 || u > 1.0) {
    return TriangleHit(FAR, vec3<f32>(0.0), 0u, false);
  }
  let q = cross(tVec, e1);
  let v = dot(direction, q) * invDet;
  if (v < 0.0 || u + v > 1.0) {
    return TriangleHit(FAR, vec3<f32>(0.0), 0u, false);
  }
  let distance = dot(e2, q) * invDet;
  if (distance <= EPS || distance >= maxDistance) {
    return TriangleHit(FAR, vec3<f32>(0.0), 0u, false);
  }
  var normal = normalize(cross(e1, e2));
  if (dot(normal, direction) > 0.0) { normal = -normal; }
  return TriangleHit(distance, normal, triangle.meta.x, true);
}

fn nearest_mesh_hit(origin: vec3<f32>, direction: vec3<f32>, maxDistance: f32) -> TriangleHit {
  var best = TriangleHit(FAR, vec3<f32>(0.0), 0u, false);
  var nearest = maxDistance;
  if (params.bvhNodeCount == 0u) {
    // Linear reference path used by the benchmark harness.
    for (var i = 0u; i < params.triangleCount; i = i + 1u) {
      let hit = intersect_mesh_triangle(origin, direction, meshTriangles[i], nearest);
      if (hit.hit) { best = hit; nearest = hit.distance; }
    }
    return best;
  }

  // Preorder node layout plus escape indices makes traversal stackless.
  var nodeIndex = 0u;
  var visits = 0u;
  loop {
    if (nodeIndex >= params.bvhNodeCount || visits >= params.bvhNodeCount) { break; }
    visits = visits + 1u;
    let node = bvhNodes[nodeIndex];
    let entry = ray_box_distance(
      origin, direction, node.boundsMin.xyz, node.boundsMax.xyz, nearest
    );
    if (entry >= FAR) {
      nodeIndex = node.meta.z;
      continue;
    }
    if (node.meta.y == 0u) {
      nodeIndex = nodeIndex + 1u;
      continue;
    }
    for (var j = 0u; j < node.meta.y; j = j + 1u) {
      let hit = intersect_mesh_triangle(
        origin, direction, meshTriangles[node.meta.x + j], nearest
      );
      if (hit.hit) { best = hit; nearest = hit.distance; }
    }
    nodeIndex = node.meta.z;
  }
  return best;
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
    var hitTriangle = false;

    let meshHit = nearest_mesh_hit(pos, dir, tHit);
    if (meshHit.hit) {
      tHit = meshHit.distance;
      materialId = meshHit.materialId;
      normal = meshHit.normal;
      hitTriangle = true;
    }

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
          hitTriangle = false;
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
    if (hitOccupant || hitTriangle) {
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
