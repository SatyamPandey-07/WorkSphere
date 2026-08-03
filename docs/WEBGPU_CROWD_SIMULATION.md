# WebGPU Crowd Density Simulation Pipeline Developer Guide

This document provides a comprehensive technical reference for WorkSphere's WebGPU crowd density simulation pipeline (`src/lib/webgpu/crowdSimulation.ts`), including the WGSL shader architecture, uniform buffer structures, pipeline layout, and benchmarking instructions against the 2D canvas fallback engine (`src/lib/webgpu/crowdFallback.ts`).

---

## 1. Overview & Architecture

WorkSphere features a high-performance WebGPU-powered crowd evacuation and density visualization engine capable of simulating 50,000+ autonomous agents in real time. The engine utilizes GPGPU compute shaders for agent movement dynamics (Boids flocking algorithm + Dijkstra flow-field pathfinding) and accumulates density fields to render a dynamic real-time heatmap overlay.

```
                     ┌──────────────────────────────────────────────────┐
                     │              Simulation Controller               │
                     └────────────────────────┬─────────────────────────┘
                                              │
                    ┌─────────────────────────┴─────────────────────────┐
                    │                                                   │
          WebGPU Available?                                    WebGPU Unavailable?
                    │                                                   │
                    ▼                                                   ▼
       ┌──────────────────────────┐                       ┌──────────────────────────┐
       │ CrowdSimulationEngine    │                       │ CrowdCanvasFallbackEngine│
       │ (src/lib/webgpu/         │                       │ (src/lib/webgpu/         │
       │  crowdSimulation.ts)     │                       │  crowdFallback.ts)       │
       └────────────┬─────────────┘                       └─────────────┬────────────┘
                    │                                                   │
       ┌────────────┴────────────┐                        ┌─────────────┴────────────┐
       │ WGSL Compute & Render   │                        │ HTML5 2D Canvas Engine   │
       │ Pipelines               │                        │ (CPU Boids + Offscreen)  │
       └─────────────────────────┘                        └──────────────────────────┘
```

---

## 2. WGSL Shader Code Structure

The WebGPU engine is powered by six WGSL shader modules defined in [`src/lib/webgpu/crowdShaders.wgsl.ts`](file:///c:/Users/babin/Desktop/ECSoC_2026/WorkSphere/src/lib/webgpu/crowdShaders.wgsl.ts):

### 2.1 Boids & Pathfinding Compute Shader (`cs_main`)

- **Purpose**: Computes agent movement per frame on GPU threads (256 threads per workgroup).
- **Steering Forces**:
  1. **Separation**: Prevents crowding between neighboring agents within `separationRadius`.
  2. **Alignment**: Matches velocity vector with nearby agents within `alignmentRadius`.
  3. **Cohesion**: Steers toward center of mass of local flock within `cohesionRadius`.
  4. **Flow-Field Pathfinding**: Samples pre-computed egress distance field texture to guide agents toward nearest exit.
  5. **Wall Avoidance**: Raycasts against boundary line segments to prevent wall collisions.

### 2.2 Agent Mesh Render Shaders (`vs_main` / `fs_main`)

- **Vertex Shader (`vs_main`)**: Performs 3D instanced rendering. Uses per-vertex mesh attributes combined with per-instance agent storage buffer data (position, velocity, status state).
- **Fragment Shader (`fs_main`)**: Applies directional lighting and colors agents based on evacuation status (e.g., active fleeing vs evacuated).

### 2.3 Density Accumulation Compute Shader (`cs_density`)

- **Purpose**: Maps agent world coordinates into a discrete 64x64 grid to calculate spatial crowd concentration.
- **Decay & Smooth Scaling**: Applies per-frame exponential decay (`0.92`) to generate trailing motion effects and normalizes peak density values for rendering.

### 2.4 Heatmap Render Shaders (`vs_fullscreen` / `fs_heatmap`)

- **Vertex Shader (`vs_fullscreen`)**: Generates a full-screen triangle.
- **Fragment Shader (`fs_heatmap`)**: Samples the density texture, applies a color gradient lookup (blue → green → yellow → red), and alpha-blends the heatmap overlay directly onto the venue floorplan.

---

## 3. Uniform Buffers & Data Layouts

Memory efficiency is maintained by using strict std140 / std430 alignment rules across WebGPU uniform and storage buffers.

### 3.1 Agent Storage Buffer (`AgentData`)

- **Stride**: 32 bytes per agent (std430 aligned).
- **Ping-Pong Buffer Strategy**: Two storage buffers (`agentBufferA` and `agentBufferB`) alternate as read/write targets between compute and render passes to prevent GPU read-after-write hazards.

```typescript
// Memory Layout per Agent (32 bytes total)
struct Agent {
  position : vec2<f32>,   // offset  0 (8 bytes)
  velocity : vec2<f32>,   // offset  8 (8 bytes)
  targetIdx: u32,         // offset 16 (4 bytes)
  state    : u32,         // offset 20 (4 bytes) - 0=fleeing, 1=evacuated, 2=stuck
  pad0     : f32,         // offset 24 (4 bytes)
  pad1     : f32,         // offset 28 (4 bytes)
}
```

### 3.2 Uniform Buffers

| Uniform Buffer Name    | Size (Bytes) | Binding       | Shader Stage                | Fields                                                                                                                                                                                                                                                                             |
| :--------------------- | :----------- | :------------ | :-------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SimParamsBuffer`      | 80 bytes     | `@binding(0)` | Compute (`cs_main`)         | `agentCount`, `deltaTime`, `time`, `separationRadius`, `alignmentRadius`, `cohesionRadius`, `separationWeight`, `alignmentWeight`, `cohesionWeight`, `pathfindingWeight`, `maxSpeed`, `maxForce`, `exitCount`, `wallCount`, `gridWidth`, `gridHeight`, `worldWidth`, `worldHeight` |
| `RenderUniformBuffer`  | 80 bytes     | `@binding(0)` | Vertex/Fragment (`vs_main`) | `mvpMatrix` (mat4x4 = 64B), `time` (4B), `agentScale` (4B), padding (8B)                                                                                                                                                                                                           |
| `DensityUniformBuffer` | 32 bytes     | `@binding(0)` | Compute (`cs_density`)      | `agentCount`, `gridWidth`, `gridHeight`, `worldWidth`, `worldHeight`, `decayFactor`, `densityMultiplier`, padding                                                                                                                                                                  |
| `HeatmapUniformBuffer` | 16 bytes     | `@binding(0)` | Fragment (`fs_heatmap`)     | `gridWidth`, `gridHeight`, `maxDensity`, `opacity`                                                                                                                                                                                                                                 |

---

## 4. WebGPU Pipeline Layout

The execution pipeline inside `renderFrame(dt: number)` follows a structured 4-phase pass sequence:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            1. COMPUTE PASS (cs_main)                        │
│ Dispatch Workgroups: Math.ceil(agentCount / 256)                            │
│ Reads: agentBufferA + distanceTexture -> Writes: agentBufferB               │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                        2. DENSITY PASS (cs_density)                         │
│ Accumulates agent positions into densityBuffer grid                        │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                         3. RENDER PASS (vs_main/fs_main)                    │
│ Instanced rendering of 3D agent meshes onto Canvas Attachment               │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                        4. HEATMAP OVERLAY PASS                              │
│ Alpha-blends 2D density heatmap texture over venue floorplan                │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Benchmarking & Performance Comparison

When WebGPU is unsupported or disabled (e.g. legacy browsers or restricted mobile contexts), the application automatically falls back to `CrowdCanvasFallbackEngine` in `src/lib/webgpu/crowdFallback.ts`.

### 5.1 Benchmarking Methodology

To run comparative performance benchmarks:

1. Open DevTools in Google Chrome or Microsoft Edge with WebGPU enabled (`chrome://flags/#enable-unsafe-webgpu`).
2. Open the Crowd Simulation panel in WorkSphere.
3. Use the density slider to benchmark performance across agent counts: 1,000, 5,000, 10,000, and 50,000 agents.
4. Measure Frame Time (ms), FPS, and CPU/GPU memory footprint using Performance Profiler.

### 5.2 Target Performance Metrics

| Agent Count | WebGPU Compute Engine FPS | 2D Canvas Fallback FPS | WebGPU Frame Time | Canvas Frame Time |
| :---------- | :------------------------ | :--------------------- | :---------------- | :---------------- |
| **1,000**   | 60 FPS                    | 60 FPS                 | ~0.4 ms           | ~2.1 ms           |
| **5,000**   | 60 FPS                    | ~32 FPS                | ~1.1 ms           | ~18.5 ms          |
| **10,000**  | 60 FPS                    | ~12 FPS                | ~1.9 ms           | ~54.0 ms          |
| **50,000**  | 60 FPS                    | < 3 FPS (Unusable)     | ~4.8 ms           | N/A (OOM / Lag)   |

### 5.3 Fallback Diagnostic Logging

To verify fallback trigger behavior in tests or diagnostics:

```typescript
import { CrowdSimulationEngine } from "@/lib/webgpu/crowdSimulation";
import { CrowdCanvasFallbackEngine } from "@/lib/webgpu/crowdFallback";

async function initCrowdSimulation(
  canvas: HTMLCanvasElement,
  config: SimulationConfig,
) {
  const engine = new CrowdSimulationEngine(canvas, config);
  const success = await engine.initialize();

  if (!success) {
    console.warn(
      "[CrowdSim] WebGPU initialization failed. Falling back to 2D Canvas engine.",
    );
    const fallbackEngine = new CrowdCanvasFallbackEngine(canvas, config);
    fallbackEngine.startRenderLoop();
    return fallbackEngine;
  }

  engine.startRenderLoop();
  return engine;
}
```
