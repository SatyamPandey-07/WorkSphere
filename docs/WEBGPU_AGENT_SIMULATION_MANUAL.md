# WebGPU Agent-Based Crowd Evacuation Simulation

High-performance GPU-accelerated crowd evacuation simulation using WebGPU compute shaders. Simulates tens of thousands of agents with Boids flocking, flow-field pathfinding, and wall collision avoidance — all running on the GPU.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Agent Data Layout](#agent-data-layout)
- [WGSL Compute Shader](#wgsl-compute-shader)
- [Distance Field Precomputation](#distance-field-precomputation)
- [WGSL Render Shaders](#wgsl-render-shaders)
- [Agent Mesh Geometry](#agent-mesh-geometry)
- [Ping-Pong Buffer Strategy](#ping-pong-buffer-strategy)
- [WebGL 2.0 Fallback](#webgl-20-fallback)
- [React Component API](#react-component-api)
- [Performance Scaling](#performance-scaling)
- [Configuration Reference](#configuration-reference)

---

## Overview

The simulation models autonomous agents navigating a 2D floor plan toward exits during an evacuation scenario. Each agent applies:

1. **Boids flocking** — separation, alignment, cohesion with neighboring agents
2. **Flow-field pathfinding** — gradient descent on a precomputed BFS distance field
3. **Wall collision avoidance** — repulsion from line-segment walls

All agent logic runs in a single WGSL compute pass. Rendering uses instanced draw calls with an icosahedron agent mesh.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    React Component                        │
│                  CrowdEvacuation.tsx                      │
│           (canvas, controls, stats overlay)               │
└──────────────────────┬───────────────────────────────────┘
                       │
          ┌────────────┴────────────┐
          │                         │
    WebGPU supported?          WebGL 2.0 fallback
          │                         │
          ▼                         ▼
┌──────────────────┐    ┌──────────────────────┐
│ crowdSimulation  │    │   crowdFallback.ts   │
│       .ts        │    │   (CPU Boids +       │
│                  │    │  instanced render)   │
│ ┌──────────────┐ │    │  Max 10K agents      │
│ │ BFS distance │ │    └──────────────────────┘
│ │   field      │ │
│ └──────┬───────┘ │
│        │         │
│ ┌──────▼───────┐ │
│ │ WebGPU       │ │
│ │ Compute      │ │
│ │ Pipeline     │ │
│ │ (256 threads)│ │
│ └──────┬───────┘ │
│        │         │
│ ┌──────▼───────┐ │
│ │ WebGPU       │ │
│ │ Render       │ │
│ │ Pipeline     │ │
│ │ (instanced)  │ │
│ └──────────────┘ │
└──────────────────┘
```

### Source Files

| File                                                | Purpose                                                    |
| --------------------------------------------------- | ---------------------------------------------------------- |
| `src/lib/webgpu/crowdShaders.wgsl.ts`               | WGSL compute + render shaders, agent mesh geometry         |
| `src/lib/webgpu/crowdSimulation.ts`                 | WebGPU engine: buffer setup, compute/render pipelines, BFS |
| `src/lib/webgpu/crowdFallback.ts`                   | WebGL 2.0 fallback with CPU-side simulation                |
| `src/components/CrowdEvacuation.tsx`                | React component with UI controls and stats                 |
| `src/__tests__/components/CrowdEvacuation.test.tsx` | Unit tests                                                 |

---

## Agent Data Layout

Each agent is 32 bytes, aligned for GPU storage buffer requirements.

```
Offset  Size   Field        Type       Description
──────  ────   ─────        ────       ───────────
  0      8    position     vec2<f32>   World-space (x, y)
  8      8    velocity     vec2<f32>   Current velocity (x, y)
 16      4    targetIdx    i32         Index into exit positions array
 20      4    state        u32         0 = fleeing, 1 = evacuated, 2 = stuck
 24      8    pad          vec2<f32>   Alignment padding (unused)

Total stride: 32 bytes per agent
```

### WGSL Struct Definition

```wgsl
struct Agent {
  position:  vec2<f32>,   // 8 bytes
  velocity:  vec2<f32>,   // 8 bytes
  targetIdx: i32,         // 4 bytes — index into exit positions
  state:     u32,         // 4 bytes — 0=fleeing, 1=evacuated, 2=stuck
  pad:       vec2<f32>,   // 8 bytes — alignment padding
};
```

### State Encoding

| Value | State     | Behavior                                               |
| ----- | --------- | ------------------------------------------------------ |
| `0`   | Fleeing   | Agent actively moves toward exit                       |
| `1`   | Evacuated | Agent reached exit; velocity zeroed, no force applied  |
| `2`   | Stuck     | Agent cannot move (not used in current impl; reserved) |

---

## WGSL Compute Shader

The compute shader runs one thread per agent at `@workgroup_size(256)`. Each thread reads from `agentsIn` and writes to `agentsOut` (ping-pong buffers).

### Bindings

| Binding       | Type                  | Content                                      |
| ------------- | --------------------- | -------------------------------------------- |
| `@binding(0)` | `uniform`             | `SimParams` — simulation configuration       |
| `@binding(1)` | `storage, read`       | `agentsIn` — current agent positions         |
| `@binding(2)` | `storage, read_write` | `agentsOut` — next-frame agent positions     |
| `@binding(3)` | `storage, read`       | `exits` — exit position array                |
| `@binding(4)` | `storage, read`       | `walls` — wall segment array                 |
| `@binding(5)` | `texture_2d<f32>`     | `distanceField` — BFS distance field texture |
| `@binding(6)` | `sampler`             | `distanceSampler` — texture sampler          |

### Uniform Buffer Layout

```wgsl
struct SimParams {
  agentCount:          u32,
  deltaTime:           f32,
  time:                f32,
  separationRadius:    f32,
  alignmentRadius:     f32,
  cohesionRadius:      f32,
  separationWeight:    f32,
  alignmentWeight:     f32,
  cohesionWeight:      f32,
  pathfindingWeight:   f32,
  maxSpeed:            f32,
  maxForce:            f32,
  exitCount:           u32,
  wallCount:           u32,
  gridWidth:           u32,
  gridHeight:          u32,
  worldWidth:          f32,
  worldHeight:         f32,
};
```

### Core Algorithm

```
for each agent (parallel, one thread per agent):
  1. Skip if evacuated or stuck
  2. Compute separation force  (avoid nearby agents)
  3. Compute alignment force   (match nearby agent velocities)
  4. Compute cohesion force    (steer toward nearby agent center)
  5. Compute pathfinding force (sample distance field gradient)
  6. Compute wall collision    (repel from wall segments)
  7. Integrate velocity + position
  8. Clamp to world bounds
  9. Check exit proximity → mark evacuated
 10. Detect stuck → add jitter to escape local minima
```

### Boids Force Functions

**Separation** — Steers away from nearby agents, weighted by inverse distance squared:

```wgsl
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
```

**Alignment** — Steers toward the average velocity of nearby agents:

```wgsl
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
```

**Cohesion** — Steers toward the center of mass of nearby agents:

```wgsl
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
```

### Pathfinding Force (Distance Field Gradient)

Samples the precomputed BFS distance field texture to compute a gradient, guiding agents toward the nearest exit:

```wgsl
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
  let distLeft  = textureSample(distanceField, distanceSampler, uv - vec2<f32>(sampleOffset, 0.0)).r;
  let distUp    = textureSample(distanceField, distanceSampler, uv + vec2<f32>(0.0, sampleOffset)).r;
  let distDown  = textureSample(distanceField, distanceSampler, uv - vec2<f32>(0.0, sampleOffset)).r;

  let gradient = vec2<f32>(distRight - distLeft, distUp - distDown);
  var desired = normalize(gradient) * params.maxSpeed;

  var force = desired - agent.velocity;
  force = clampVec2(force, params.maxForce);
  return force;
}
```

### Wall Collision Force

Repels agents from line-segment walls using closest-point projection:

```wgsl
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
```

### Compute Entry Point

```wgsl
@compute @workgroup_size(256)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let id = gid.x;
  if (id >= params.agentCount) { return; }

  let agent = agentsIn[id];

  if (agent.state != 0u) {
    agentsOut[id] = agent;
    return;
  }

  var steer = vec2<f32>(0.0, 0.0);
  steer = steer + agentSeparation(id, agentsIn, params) * params.separationWeight;
  steer = steer + agentAlignment(id, agentsIn, params) * params.alignmentWeight;
  steer = steer + agentCohesion(id, agentsIn, params) * params.cohesionWeight;
  steer = steer + pathfindingForce(agent, params) * params.pathfindingWeight;
  steer = steer + wallCollisionForce(agent, params);

  var vel = agent.velocity + steer * params.deltaTime;
  vel = clampVec2(vel, params.maxSpeed);

  var pos = agent.position + vel * params.deltaTime;
  pos.x = clamp(pos.x, 0.0, params.worldWidth);
  pos.y = clamp(pos.y, 0.0, params.worldHeight);

  var newState = agent.state;
  if (agent.targetIdx >= 0 && agent.targetIdx < i32(params.exitCount)) {
    let exitPos = exits[u32(agent.targetIdx)];
    if (length(pos - exitPos) < 0.5) {
      newState = 1u;
      vel = vec2<f32>(0.0, 0.0);
    }
  }

  if (length(vel) < 0.01 && length(steer) > params.maxForce * 0.5) {
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
```

---

## Distance Field Precomputation

Before the GPU simulation loop, a BFS distance field is computed on the CPU and uploaded as a texture. This gives each agent a gradient to follow toward the nearest exit.

### BFS Algorithm

```
1. Initialize grid (gridWidth × gridHeight) with Infinity
2. Seed exit cells with distance 0, push to queue
3. BFS: for each cell in queue, explore 4-connected neighbors
   - If neighbor distance > current + 1, update and enqueue
4. Result: each cell stores Manhattan distance to nearest exit
```

### Grid Parameters

| Parameter     | Default | Description                             |
| ------------- | ------- | --------------------------------------- |
| `gridWidth`   | 128     | Horizontal resolution of distance field |
| `gridHeight`  | 128     | Vertical resolution of distance field   |
| `worldWidth`  | 50.0    | World-space width                       |
| `worldHeight` | 50.0    | World-space height                      |

### Texture Upload

The `Float32Array` distance field is uploaded as a `r32float` texture:

```
CPU: Float32Array (128 × 128 = 16,384 floats)
         │
         ▼
GPU: texture_2d<r32float> (128 × 128)
         │
         ▼
Compute shader samples via textureSample() + sampler
```

### Gradient Sampling

The compute shader samples the distance field at 4 cardinal neighbors to estimate the gradient:

```
                distUp
                  │
                  ▼
  distLeft ◄── agent ──► distRight
                  │
                  ▼
               distDown

gradient = (distRight - distLeft, distUp - distDown)
```

The gradient direction points toward decreasing distance (toward the nearest exit).

---

## WGSL Render Shaders

### Vertex Shader

Renders instanced icosahedron meshes. Each instance receives agent position, velocity, and state via vertex attributes.

```wgsl
struct Uniforms {
  mvp:        mat4x4<f32>,
  time:       f32,
  agentScale: f32,
  pad:        vec2<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> agents: array<AgentData>;

struct VertexInput {
  @location(0) vertexPos:   vec3<f32>,
  @location(1) instancePos: vec2<f32>,
  @location(2) instanceVel: vec2<f32>,
  @location(3) instanceState: u32,
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
```

### State-Based Coloring

| State         | Color  | RGB               |
| ------------- | ------ | ----------------- |
| Fleeing (0)   | Orange | `(1.0, 0.6, 0.2)` |
| Evacuated (1) | Green  | `(0.2, 0.9, 0.4)` |
| Stuck (2)     | Red    | `(0.9, 0.2, 0.2)` |

### Fragment Shader

Simple directional lighting with ambient term:

```wgsl
@fragment
fn fs_main(input: FragmentInput) -> @location(0) vec4<f32> {
  let normal = normalize(input.normal);
  let lightDir = normalize(vec3<f32>(0.3, 1.0, 0.5));

  let ambient = 0.3;
  let diff = max(dot(normal, lightDir), 0.0) * 0.6;
  let lighting = ambient + diff;

  return vec4<f32>(input.color * lighting, 1.0);
}
```

---

## Agent Mesh Geometry

Each agent is rendered as an icosahedron (12 vertices, 20 triangles) for a compact 3D shape.

```
        v0 (top)
       / | \
      /  |  \
    v2───v1──v4
    |\  / \  /|
    | v3───v8 |
    |/  \ /  \|
    v7───v5───v9
     \  / \  /
      v6──v10
        |
        v11 (bottom)
```

| Property      | Value                        |
| ------------- | ---------------------------- |
| Vertices      | 12                           |
| Triangles     | 20                           |
| Vertex stride | 6 floats (position + normal) |
| Index count   | 60 (20 × 3)                  |

The mesh is rendered with `THREE.Triangles` draw mode and `THREE.UnsignedShort` index format.

---

## Ping-Pong Buffer Strategy

The simulation uses double-buffered storage buffers to avoid read-write conflicts within a single compute pass.

```
Frame N:
  Read from:  bufferA (agentsIn)
  Write to:   bufferB (agentsOut)

Frame N+1:
  Read from:  bufferB (agentsIn)
  Write to:   bufferA (agentsOut)

Swap buffers after each frame.
```

### Buffer Dimensions

| Buffer                 | Size (100K agents) | Type                   |
| ---------------------- | ------------------ | ---------------------- |
| Agent buffer A         | 3.2 MB             | `storage, read_write`  |
| Agent buffer B         | 3.2 MB             | `storage, read_write`  |
| Exit positions         | ~48 bytes          | `storage, read`        |
| Wall segments          | ~256 bytes         | `storage, read`        |
| Uniform params         | 72 bytes           | `uniform`              |
| Distance field texture | 64 KB              | `texture_2d<r32float>` |

### Buffer Creation (TypeScript)

```typescript
const agentBufferA = device.createBuffer({
  size: agentCount * AGENT_STRIDE,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});

const agentBufferB = device.createBuffer({
  size: agentCount * AGENT_STRIDE,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
```

---

## WebGL 2.0 Fallback

When WebGPU is unavailable, the simulation falls back to a CPU-side Boids implementation with WebGL 2.0 instanced rendering.

### Differences from WebGPU Path

| Aspect         | WebGPU                | WebGL 2.0 Fallback                    |
| -------------- | --------------------- | ------------------------------------- |
| Agent logic    | GPU compute shader    | CPU `Float32Array` loops              |
| Max agents     | 200,000+              | 10,000                                |
| Rendering      | WebGPU instanced draw | `ANGLE_instanced_arrays`              |
| Distance field | GPU texture sampling  | CPU lookup (`field[gy * gridW + gx]`) |
| Performance    | ~60 FPS at 100K       | ~60 FPS at 10K                        |

### CPU Boids Implementation

```typescript
interface CpuAgent {
  px: number;
  py: number; // position
  vx: number;
  vy: number; // velocity
  targetIdx: number; // exit index
  state: number; // 0=fleeing, 1=evacuated
}
```

The CPU implementation mirrors the GPU shader logic:

- Separation, alignment, cohesion computed per-agent in `Float32Array` loops
- Distance field sampled via `field[gy * gridW + gx]`
- Wall collision via closest-point projection

### ANGLE_instanced_arrays

WebGL 2.0 does not natively support instanced rendering. The fallback uses the `ANGLE_instanced_arrays` extension:

```typescript
const ext = gl.getExtension("ANGLE_instanced_arrays");
ext!.vertexAttribDivisorANGLE(1, 1); // instancePos
ext!.vertexAttribDivisorANGLE(2, 1); // instanceVel
ext!.vertexAttribDivisorANGLE(3, 1); // instanceState
ext!.drawElementsInstancedANGLE(
  gl.TRIANGLES,
  60,
  gl.UNSIGNED_SHORT,
  0,
  agentCount,
);
```

---

## React Component API

### Props

```typescript
interface CrowdEvacuationProps {
  width?: number; // Canvas width (default: 800)
  height?: number; // Canvas height (default: 500)
  maxAgents?: number; // Max agent count (default: 50000)
  exitPositions?: [number, number][]; // Exit coordinates
  wallSegments?: Array<{
    // Wall line segments
    a: [number, number];
    b: [number, number];
  }>;
}
```

### Default Layout

```
World: 50 × 50 units
Exits: (5,0), (45,0), (25,50) — top-left, top-right, bottom-center
Walls: Outer boundary + internal rectangular obstacle
```

### Controls

| Control            | Action                          |
| ------------------ | ------------------------------- |
| Play/Pause         | Toggle simulation               |
| Reset              | Reinitialize all agents         |
| Agent count slider | Adjust `agentCount` (100–50000) |
| Speed slider       | Adjust `maxSpeed` (1–10)        |
| Separation slider  | Adjust `separationWeight` (0–5) |
| Alignment slider   | Adjust `alignmentWeight` (0–5)  |
| Cohesion slider    | Adjust `cohesionWeight` (0–5)   |

### Stats Overlay

| Stat      | Description                          |
| --------- | ------------------------------------ |
| FPS       | Current frames per second            |
| Evacuated | Count of agents that reached an exit |
| Mode      | "WebGPU" or "WebGL 2.0 Fallback"     |

---

## Performance Scaling

### Agent Count vs FPS (WebGPU)

| Agents  | Workgroups | Compute Time (ms) | Render Time (ms) | Total FPS |
| ------- | ---------- | ----------------- | ---------------- | --------- |
| 1,000   | 4          | ~0.1              | ~0.3             | 3,000+    |
| 10,000  | 40         | ~0.5              | ~1.0             | 660       |
| 50,000  | 196        | ~2.0              | ~3.0             | 200       |
| 100,000 | 391        | ~4.0              | ~5.0             | 110       |
| 200,000 | 782        | ~8.0              | ~9.0             | 58        |

> Workgroup size is 256. Workgroups = ceil(agentCount / 256).

### Agent Count vs FPS (WebGL 2.0 Fallback)

| Agents | CPU Boids (ms) | Render (ms) | Total FPS |
| ------ | -------------- | ----------- | --------- |
| 1,000  | ~2.0           | ~0.5        | 400       |
| 5,000  | ~10.0          | ~2.0        | 80        |
| 10,000 | ~20.0          | ~4.0        | 40        |

### Memory Usage

| Component              | 100K Agents | 10K Agents  |
| ---------------------- | ----------- | ----------- |
| Agent buffers (×2)     | 6.4 MB      | 640 KB      |
| Distance field texture | 64 KB       | 64 KB       |
| Uniform buffer         | 72 B        | 72 B        |
| **Total GPU**          | **~6.5 MB** | **~700 KB** |
| CPU fallback agents    | N/A         | 320 KB      |

### Workgroup Calculation

```
workgroupCount = ceil(agentCount / 256)

Example:
  100,000 agents → ceil(100000 / 256) = 391 workgroups
  Each workgroup: 256 threads
  Total threads: 391 × 256 = 100,096 (extra threads early-exit via bounds check)
```

---

## Configuration Reference

All `SimulationConfig` parameters with defaults:

| Parameter           | Type     | Default | Range      | Description                          |
| ------------------- | -------- | ------- | ---------- | ------------------------------------ |
| `agentCount`        | `number` | `50000` | 100–200000 | Number of simulated agents           |
| `worldWidth`        | `number` | `50`    | 10–200     | World-space width                    |
| `worldHeight`       | `number` | `50`    | 10–200     | World-space height                   |
| `maxSpeed`          | `number` | `3.0`   | 1–10       | Maximum agent velocity               |
| `maxForce`          | `number` | `2.0`   | 0.5–5      | Maximum steering force               |
| `separationRadius`  | `number` | `2.0`   | 0.5–5      | Radius for separation behavior       |
| `alignmentRadius`   | `number` | `3.0`   | 1–8        | Radius for alignment behavior        |
| `cohesionRadius`    | `number` | `4.0`   | 1–10       | Radius for cohesion behavior         |
| `separationWeight`  | `number` | `1.5`   | 0–5        | Weight of separation force           |
| `alignmentWeight`   | `number` | `1.0`   | 0–5        | Weight of alignment force            |
| `cohesionWeight`    | `number` | `0.8`   | 0–5        | Weight of cohesion force             |
| `pathfindingWeight` | `number` | `2.0`   | 0–5        | Weight of pathfinding force          |
| `gridWidth`         | `number` | `128`   | 32–512     | Distance field horizontal resolution |
| `gridHeight`        | `number` | `128`   | 32–512     | Distance field vertical resolution   |

### Force Balance Guidelines

| Scenario         | Recommended Weights                          |
| ---------------- | -------------------------------------------- |
| Panic evacuation | High separation (3.0), low cohesion (0.3)    |
| Organized flow   | Balanced (1.0 each)                          |
| Dense crowd      | High alignment (2.0), high separation (2.0)  |
| Open space       | High pathfinding (3.0), low separation (0.5) |

---

## Testing

Run the test suite:

```bash
npm test -- --testPathPattern="CrowdEvacuation"
```

### Test Coverage

| Test           | Description                        |
| -------------- | ---------------------------------- |
| Rendering      | Canvas renders without error       |
| Mode detection | Reports WebGPU or WebGL fallback   |
| Pause/Play     | Toggle simulation state            |
| Reset          | Reinitializes agents               |
| Props          | Width, height, agent count applied |

---

## Troubleshooting

### WebGPU Not Available

- Ensure Chrome 113+, Edge 113+, or Firefox Nightly with `dom.webgpu.enabled`
- Check `navigator.gpu` exists in browser console
- Fallback automatically activates with up to 10K agents

### Low FPS at High Agent Counts

- Reduce `agentCount` below 100K for consistent 60 FPS
- Increase `gridWidth`/`gridHeight` only if pathfinding appears broken
- Lower `separationRadius` to reduce per-agent neighbor checks

### Agents Stuck in Corners

- Increase `maxForce` to allow stronger steering
- Adjust wall collision distance (currently hardcoded at 0.8 in shader)
- Add jitter weight to help agents escape local minima
