/**
 * WGSL Shader Definitions for WebGPU Crowd Evacuation Simulation
 *
 * Compute pipeline: Boids flocking + flow-field pathfinding + collision avoidance
 * Render pipeline: Instanced agent mesh rendering with state-based coloring
 */

// ── Agent Data Layout (32 bytes per agent, padded for alignment) ─────
// position:  vec2<f32>   (8 bytes)
// velocity:  vec2<f32>   (8 bytes)
// targetIdx: i32         (4 bytes) — index into exit positions
// state:     u32         (4 bytes) — 0=fleeing, 1=evacuated, 2=stuck
// pad:       vec2<f32>   (8 bytes) — alignment padding

const _AGENT_STRIDE = 32; // bytes per agent (must match WGSL)

// ── Compute Shader: Boids + Pathfinding ─────────────────────────────
export const computeShader = /* wgsl */ `
struct SimParams {
  agentCount: u32,
  deltaTime: f32,
  time: f32,
  separationRadius: f32,
  alignmentRadius: f32,
  cohesionRadius: f32,
  separationWeight: f32,
  alignmentWeight: f32,
  cohesionWeight: f32,
  pathfindingWeight: f32,
  maxSpeed: f32,
  maxForce: f32,
  exitCount: u32,
  wallCount: u32,
  gridWidth: u32,
  gridHeight: u32,
  worldWidth: f32,
  worldHeight: f32,
};

@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var<storage, read> agentsIn: array<Agent>;
@group(0) @binding(2) var<storage, read_write> agentsOut: array<Agent>;
@group(0) @binding(3) var<storage, read> exits: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read> walls: array<WallSegment>;
@group(0) @binding(5) var distanceField: texture_2d<f32>;
@group(0) @binding(6) var distanceSampler: sampler;

struct Agent {
  position: vec2<f32>,
  velocity: vec2<f32>,
  targetIdx: i32,
  state: u32,
  pad: vec2<f32>,
};

struct WallSegment {
  a: vec2<f32>,
  b: vec2<f32>,
};

fn clampVec2(v: vec2<f32>, maxLen: f32) -> vec2<f32> {
  let len = length(v);
  if (len > maxLen && len > 0.0) {
    return v / len * maxLen;
  }
  return v;
}

fn agentSeparation(id: u32, agents: array<Agent>, params: SimParams) -> vec2<f32> {
  var force = vec2<f32>(0.0, 0.0);
  var count = 0u;
  let pos = agents[id].position;

  for (var i = 0u; i < params.agentCount; i = i + 1u) {
    if (i == id) { continue; }
    let other = agents[i];
    if (other.state != 0u) { continue; }

    let diff = pos - other.position;
    let dist = length(diff);
    if (dist < params.separationRadius && dist > 0.001) {
      force = force + diff / dist / dist;
      count = count + 1u;
    }
  }

  if (count > 0u) {
    force = force / f32(count);
    force = normalize(force) * params.maxSpeed - agents[id].velocity;
    force = clampVec2(force, params.maxForce);
  }
  return force;
}

fn agentAlignment(id: u32, agents: array<Agent>, params: SimParams) -> vec2<f32> {
  var avgVel = vec2<f32>(0.0, 0.0);
  var count = 0u;
  let pos = agents[id].position;

  for (var i = 0u; i < params.agentCount; i = i + 1u) {
    if (i == id) { continue; }
    let other = agents[i];
    if (other.state != 0u) { continue; }

    let dist = length(pos - other.position);
    if (dist < params.alignmentRadius) {
      avgVel = avgVel + other.velocity;
      count = count + 1u;
    }
  }

  if (count > 0u) {
    avgVel = avgVel / f32(count);
    var force = avgVel - agents[id].velocity;
    force = clampVec2(force, params.maxForce);
    return force;
  }
  return vec2<f32>(0.0, 0.0);
}

fn agentCohesion(id: u32, agents: array<Agent>, params: SimParams) -> vec2<f32> {
  var center = vec2<f32>(0.0, 0.0);
  var count = 0u;
  let pos = agents[id].position;

  for (var i = 0u; i < params.agentCount; i = i + 1u) {
    if (i == id) { continue; }
    let other = agents[i];
    if (other.state != 0u) { continue; }

    let dist = length(pos - other.position);
    if (dist < params.cohesionRadius) {
      center = center + other.position;
      count = count + 1u;
    }
  }

  if (count > 0u) {
    center = center / f32(count);
    var desired = center - pos;
    desired = normalize(desired) * params.maxSpeed;
    var force = desired - agents[id].velocity;
    force = clampVec2(force, params.maxForce);
    return force;
  }
  return vec2<f32>(0.0, 0.0);
}

fn pathfindingForce(agent: Agent, params: SimParams) -> vec2<f32> {
  if (agent.targetIdx < 0 || agent.targetIdx >= i32(params.exitCount)) {
    return vec2<f32>(0.0, 0.0);
  }

  let exitPos = exits[u32(agent.targetIdx)];
  let toExit = exitPos - agent.position;
  let dist = length(toExit);

  if (dist < 0.5) {
    return vec2<f32>(0.0, 0.0);
  }

  // Sample distance field for gradient
  let uv = agent.position / vec2<f32>(params.worldWidth, params.worldHeight);
  let sampleOffset = 1.0 / f32(params.gridWidth);

  let distRight = textureSample(distanceField, distanceSampler, uv + vec2<f32>(sampleOffset, 0.0)).r;
  let distLeft = textureSample(distanceField, distanceSampler, uv - vec2<f32>(sampleOffset, 0.0)).r;
  let distUp = textureSample(distanceField, distanceSampler, uv + vec2<f32>(0.0, sampleOffset)).r;
  let distDown = textureSample(distanceField, distanceSampler, uv - vec2<f32>(0.0, sampleOffset)).r;

  let gradient = vec2<f32>(distRight - distLeft, distUp - distDown);
  var desired = normalize(gradient) * params.maxSpeed;

  var force = desired - agent.velocity;
  force = clampVec2(force, params.maxForce);
  return force;
}

fn wallCollisionForce(agent: Agent, params: SimParams) -> vec2<f32> {
  var force = vec2<f32>(0.0, 0.0);
  let pos = agent.position;
  let wallRepelDist = 0.8;

  for (var i = 0u; i < params.wallCount; i = i + 1u) {
    let wall = walls[i];
    let ab = wall.b - wall.a;
    let ap = pos - wall.a;
    let t = clamp(dot(ap, ab) / dot(ab, ab), 0.0, 1.0);
    let closest = wall.a + ab * t;
    let diff = pos - closest;
    let dist = length(diff);

    if (dist < wallRepelDist && dist > 0.001) {
      force = force + (diff / dist) * (wallRepelDist - dist) / wallRepelDist;
    }
  }

  return force * params.maxForce * 2.0;
}

@compute @workgroup_size(256)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let id = gid.x;
  if (id >= params.agentCount) { return; }

  let agent = agentsIn[id];

  // Evacuated or stuck agents don't move
  if (agent.state != 0u) {
    agentsOut[id] = agent;
    return;
  }

  // Compute boids forces
  var steer = vec2<f32>(0.0, 0.0);
  steer = steer + agentSeparation(id, agentsIn, params) * params.separationWeight;
  steer = steer + agentAlignment(id, agentsIn, params) * params.alignmentWeight;
  steer = steer + agentCohesion(id, agentsIn, params) * params.cohesionWeight;

  // Pathfinding toward exit
  steer = steer + pathfindingForce(agent, params) * params.pathfindingWeight;

  // Wall collision
  steer = steer + wallCollisionForce(agent, params);

  // Integrate
  var vel = agent.velocity + steer * params.deltaTime;
  vel = clampVec2(vel, params.maxSpeed);

  var pos = agent.position + vel * params.deltaTime;

  // World bounds clamp
  pos.x = clamp(pos.x, 0.0, params.worldWidth);
  pos.y = clamp(pos.y, 0.0, params.worldHeight);

  // Check exit proximity
  var newState = agent.state;
  if (agent.targetIdx >= 0 && agent.targetIdx < i32(params.exitCount)) {
    let exitPos = exits[u32(agent.targetIdx)];
    if (length(pos - exitPos) < 0.5) {
      newState = 1u; // evacuated
      vel = vec2<f32>(0.0, 0.0);
    }
  }

  // Detect stuck (near-zero velocity for extended time)
  if (length(vel) < 0.01 && length(steer) > params.maxForce * 0.5) {
    // Add small random jitter to escape local minima
    let jitter = vec2<f32>(
      sin(params.time * 100.0 + f32(id) * 17.3) * 0.1,
      cos(params.time * 100.0 + f32(id) * 31.7) * 0.1
    );
    vel = vel + jitter;
  }

  var out = agent;
  out.position = pos;
  out.velocity = vel;
  out.state = newState;
  agentsOut[id] = out;
}
`;

// ── Render Shader: Instanced Agent Rendering ────────────────────────
export const agentVertexShader = /* wgsl */ `
struct Uniforms {
  mvp: mat4x4<f32>,
  time: f32,
  agentScale: f32,
  pad: vec2<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct AgentData {
  position: vec2<f32>,
  velocity: vec2<f32>,
  targetIdx: i32,
  state: u32,
  pad: vec2<f32>,
};

@group(0) @binding(1) var<storage, read> agents: array<AgentData>;

struct VertexInput {
  @location(0) vertexPos: vec3<f32>,
  @location(1) instancePos: vec2<f32>,
  @location(2) instanceVel: vec2<f32>,
  @location(3) instanceState: u32,
};

struct VertexOutput {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) normal: vec3<f32>,
};

const STATE_COLORS = array<vec3<f32>, 3>(
  vec3<f32>(1.0, 0.6, 0.2),   // fleeing — orange
  vec3<f32>(0.2, 0.9, 0.4),   // evacuated — green
  vec3<f32>(0.9, 0.2, 0.2),   // stuck — red
);

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;

  let scale = uniforms.agentScale;
  let worldPos = vec3<f32>(
    input.instancePos.x + input.vertexPos.x * scale,
    input.vertexPos.y * scale + 0.1,
    input.instancePos.y + input.vertexPos.z * scale
  );

  output.clipPosition = uniforms.mvp * vec4<f32>(worldPos, 1.0);
  output.normal = input.vertexPos;
  output.color = STATE_COLORS[input.instanceState];

  return output;
}
`;

export const agentFragmentShader = /* wgsl */ `
struct FragmentInput {
  @location(0) color: vec3<f32>,
  @location(1) normal: vec3<f32>,
};

@fragment
fn fs_main(input: FragmentInput) -> @location(0) vec4<f32> {
  let normal = normalize(input.normal);
  let lightDir = normalize(vec3<f32>(0.3, 1.0, 0.5));

  let ambient = 0.3;
  let diff = max(dot(normal, lightDir), 0.0) * 0.6;
  let lighting = ambient + diff;

  return vec4<f32>(input.color * lighting, 1.0);
}
`;

// ── Agent Mesh Geometry (Icosahedron) ───────────────────────────────
// 12 vertices, 20 triangles for a small agent shape
export const AGENT_VERTICES = new Float32Array([
  // Top cap
  0, 1, 0, 0, 1, 0, 0, 1, 0.943, 0.333, 0, 0.943, 0.333, 0, 0.943, 0.333,
  -0.471, 0.333, 0.816, -0.471, 0.333, 0.816, -0.471, 0.333, -0.471, 0.333,
  -0.816, -0.471, 0.333, -0.816, -0.471, 0.333,
  // Bottom cap
  0, -1, 0, 0, -1, 0, 0, -1, 0.471, -0.333, 0.816, 0.471, -0.333, 0.816, 0.471,
  -0.333, 0.943, -0.333, 0, 0.943, -0.333, 0, 0.943, -0.333, 0.471, -0.333,
  -0.816, 0.471, -0.333, -0.816, 0.471, -0.333, -0.471, -0.333, -0.816, -0.471,
  -0.333, -0.816, -0.471, -0.333, -0.471, -0.333, 0.816, -0.471, -0.333, 0.816,
  -0.471, -0.333,
]);

export const AGENT_INDICES = new Uint16Array([
  0, 2, 1, 0, 3, 2, 0, 4, 3, 0, 1, 4, 5, 6, 7, 5, 7, 8, 5, 8, 9, 5, 9, 10, 5,
  10, 6, 1, 2, 6, 2, 7, 6, 2, 3, 7, 3, 8, 7, 3, 4, 8, 4, 9, 8, 4, 1, 9, 1, 6, 9,
  6, 10, 9,
]);
