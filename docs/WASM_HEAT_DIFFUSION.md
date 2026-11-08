# WASM Heat Diffusion Simulation Engine

This document describes the architecture, mathematics, buffer layout, shader pipeline, React
component lifecycle, and Rust/WASM build pipeline for the thermal diffusion system used to
render real-time HVAC heat-distribution overlays on venue floor plans.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Finite Difference Heat Equation](#2-finite-difference-heat-equation)
3. [Buffer Layout: Ping-Pong Grids](#3-buffer-layout-ping-pong-grids)
4. [HVAC Sensor Placement and Influence](#4-hvac-sensor-placement-and-influence)
5. [WebGPU Compute Path (Primary)](#5-webgpu-compute-path-primary)
6. [WebGL 2.0 Fallback Path](#6-webgl-20-fallback-path)
7. [Heatmap Color Ramp](#7-heatmap-color-ramp)
8. [React Component Lifecycle](#8-react-component-lifecycle)
9. [Rust / WASM Build Pipeline](#9-rust--wasm-build-pipeline)
10. [Web Worker Message Passing](#10-web-worker-message-passing)
11. [Benchmarking](#11-benchmarking)

---

## 1. System Overview

The thermal diffusion subsystem solves the 2-D heat equation over a discrete grid that mirrors
the seating layout of a venue floor plan.  Each grid cell holds a temperature value in degrees
Celsius.  HVAC sensor readings are injected as fixed-temperature boundary conditions, and the
field is advanced one Jacobi iteration per animation frame.

```
┌─────────────────────────────────────────────────────────────┐
│  HeatDiffusionOverlay (React, "use client")                  │
│                                                              │
│  navigator.gpu?  ──yes──▶  HeatDiffusionEngine (WebGPU)     │
│       │                      WGSL compute + render pass      │
│       no                                                      │
│       └────────────────▶  HeatDiffusionFallback (WebGL 2.0) │
│                              CPU Jacobi + R32F texture        │
└─────────────────────────────────────────────────────────────┘
             │                          │
             └──────────┬───────────────┘
                        │
               heatEquation.ts
         (shared math, types, WASM interface)
```

Relevant source files:

| File | Purpose |
|---|---|
| `src/lib/webgpu/heatEquation.ts` | Types, `stepHeatDiffusion`, `createAmbientGrid` |
| `src/lib/webgpu/heatDiffusion.ts` | `HeatDiffusionEngine` — WebGPU primary path |
| `src/lib/webgpu/heatDiffusionFallback.ts` | `HeatDiffusionFallback` — WebGL 2.0 path |
| `src/lib/webgpu/heatShaders.wgsl.ts` | WGSL compute + render shaders; GLSL ES 3.0 fallback shaders |
| `src/components/venue/floorplan/HeatDiffusionOverlay.tsx` | React wrapper component |
| `wasm/heat-diffusion/src/lib.rs` | Rust WASM implementation of `calculate_heat_diffusion` |

---

## 2. Finite Difference Heat Equation

The simulation solves the 2-D diffusion equation using an **explicit (forward Euler) finite
difference** scheme with a **5-point Laplacian stencil** (Jacobi iteration):

```
T[t+1][x,y] = T[t][x,y]  +  α · Δt · ∇²T[x,y]
```

where the discrete Laplacian is:

```
∇²T[x,y] = T[x-1,y] + T[x+1,y] + T[x,y-1] + T[x,y+1] − 4·T[x,y]
```

After the diffusion step a soft pull toward the ambient temperature stabilises the field and
prevents unbounded growth:

```
T[t+1][x,y] += 0.002 · (Tambient − T[t+1][x,y])
```

### Default parameters

| Parameter | Symbol | Default | Description |
|---|---|---|---|
| `alpha` | α | `0.15` | Thermal diffusivity coefficient |
| `dt` | Δt | `1` | Time step per iteration |
| `ambient` | T_amb | `22 °C` | Background temperature |
| `width` | W | `64` cells | Grid width |
| `height` | H | `64` cells | Grid height |

### Boundary conditions

Grid edges use **Neumann zero-flux** conditions: out-of-bounds neighbours are clamped to the
cell's own index, making the derivative zero at the boundary.  Both the WGSL `select` built-in
and the TypeScript/Rust fallbacks implement this identically:

```typescript
// TypeScript (heatEquation.ts)
const xl = x === 0 ? x : x - 1;
const xr = x + 1 >= w ? x : x + 1;
```

```wgsl
// WGSL (heatShaders.wgsl.ts)
let xl = select(x - 1u, x, x == 0u);
let xr = select(x + 1u, x, x + 1u >= w);
```

```rust
// Rust (wasm/heat-diffusion/src/lib.rs)
let xl = if x == 0 { x } else { x - 1 };
let xr = if x + 1 >= w { x } else { x + 1 };
```

---

## 3. Buffer Layout: Ping-Pong Grids

Both paths maintain two equal-sized flat arrays (`gridA` / `gridB`), each holding `W × H`
32-bit floats.  On every simulation step one buffer is treated as read-only input and the other
as write-only output.  After the step the roles are swapped via a boolean `ping` flag.

```
ping = true  → read A, write B
ping = false → read B, write A
```

This double-buffering avoids read-after-write hazards; no cell reads a value that was updated
in the same iteration.

### WebGPU buffer allocation

```
tempBufferA  – GPUBuffer, STORAGE | COPY_DST, size = W × H × 4 bytes
tempBufferB  – GPUBuffer, STORAGE | COPY_DST, size = W × H × 4 bytes
paramsBuffer – GPUBuffer, UNIFORM | COPY_DST, 32 bytes (8 × u32/f32)
sensorBuffer – GPUBuffer, STORAGE | COPY_DST, N × 16 bytes
renderUniformBuffer – GPUBuffer, UNIFORM | COPY_DST, 16 bytes
sizeBuffer   – GPUBuffer, UNIFORM | COPY_DST, 16 bytes
```

### `HeatParams` uniform layout (32 bytes, std140-compatible)

| Offset | Type | Field | Description |
|---|---|---|---|
| 0 | `u32` | `width` | Grid width in cells |
| 4 | `u32` | `height` | Grid height in cells |
| 8 | `f32` | `alpha` | Diffusivity coefficient |
| 12 | `f32` | `dt` | Time step |
| 16 | `f32` | `ambient` | Ambient temperature (°C) |
| 20 | `u32` | `sensorCount` | Number of active HVAC sensors |
| 24 | `f32` | `_pad0` | Padding |
| 28 | `f32` | `_pad1` | Padding |

### `Sensor` storage layout (16 bytes per entry)

| Offset | Type | Field |
|---|---|---|
| 0 | `u32` | `x` (grid column) |
| 4 | `u32` | `y` (grid row) |
| 8 | `f32` | `temperature` (°C) |
| 12 | `f32` | `_pad` |

### WebGL / WASM buffer

The fallback uses two plain `Float32Array` instances of length `W × H` allocated on the
JavaScript heap.  The Rust WASM function receives pointers to these as mutable slices.

---

## 4. HVAC Sensor Placement and Influence

Sensors are typed as:

```typescript
type HvacSensor = {
  x: number;   // grid column (0-based)
  y: number;   // grid row (0-based)
  temperature: number; // fixed Celsius value
};
```

Sensors are treated as **Dirichlet boundary conditions**: after each diffusion iteration their
cells are overwritten with the sensor's fixed temperature, regardless of what diffusion
computed.  This means sensor cells act as perpetual heat or cold sources that drive the
surrounding field.

Default sensors (used when none are provided) are positioned at fractional grid positions so
they scale naturally with any grid dimension:

| Position | Temperature |
|---|---|
| 20% × 20% | 28 °C (warm spot) |
| 75% × 30% | 19 °C (cool spot) |
| 50% × 70% | 26 °C (warm spot) |
| 15% × 80% | 21 °C (mild spot) |

Sensors can be updated at runtime via `setSensors(sensors: HvacSensor[])`.  In the WebGPU
path this re-writes `paramsBuffer` and `sensorBuffer` on the GPU queue immediately.

---

## 5. WebGPU Compute Path (Primary)

`HeatDiffusionEngine` (`src/lib/webgpu/heatDiffusion.ts`) is activated when `navigator.gpu`
exists and `adapter.requestDevice()` succeeds.

### Initialization sequence

```
navigator.gpu.requestAdapter()
  └─ adapter.requestDevice()
       ├─ canvas.getContext("webgpu")
       ├─ context.configure({ device, format, alphaMode: "premultiplied" })
       ├─ createBuffers()   – allocate and upload initial grid data
       └─ createPipelines() – compile WGSL, build bind group layouts
```

### Per-frame render loop

Each `requestAnimationFrame` tick executes one `GPUCommandEncoder` that encodes:

1. **Compute pass** — `cs_main` dispatched as `⌈W/16⌉ × ⌈H/16⌉` workgroups of 16×16
   threads.  Each thread computes one cell's next temperature and re-asserts any sensor that
   lands on its coordinate.
2. **Render pass** — a fullscreen triangle (`draw(3)`) runs `vs_main` / `fs_main`, sampling
   the freshly written output buffer and mapping temperature to RGBA via `heatColor()`.

```
ping=true   bind group A → compute reads A, writes B → render reads B
ping=false  bind group B → compute reads B, writes A → render reads A
```

### Compute bind group layout

| Binding | Type | Contents |
|---|---|---|
| 0 | `uniform` | `HeatParams` (32 bytes) |
| 1 | `read-only-storage` | input temperature buffer |
| 2 | `storage` (read_write) | output temperature buffer |
| 3 | `read-only-storage` | sensor array |

### Render bind group layout

| Binding | Type | Contents |
|---|---|---|
| 0 | `uniform` | `HeatUniforms` (minTemp, maxTemp, opacity) |
| 1 | `read-only-storage` | output temperature buffer (same as compute output) |
| 2 | `uniform` | `GridSize` (width, height) |

### Alpha blending

The render pipeline is configured with standard premultiplied alpha blending so the heatmap
overlay composites transparently over any underlying canvas content:

```
color:  src-alpha / one-minus-src-alpha / add
alpha:  one       / one-minus-src-alpha / add
```

---

## 6. WebGL 2.0 Fallback Path

`HeatDiffusionFallback` (`src/lib/webgpu/heatDiffusionFallback.ts`) is used when WebGPU is
unavailable.  The Jacobi iteration is performed in JavaScript (or via the Rust WASM module)
on the CPU, and the resulting temperature data is uploaded to the GPU as a `R32F` texture each
frame.

### Initialization sequence

```
canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true })
  ├─ compile GLSL ES 3.0 vertex + fragment shaders
  ├─ link program
  ├─ create fullscreen-triangle VAO + VBO
  ├─ create R32F texture (TEXTURE_MIN/MAG_FILTER: LINEAR, WRAP: CLAMP_TO_EDGE)
  └─ enable SRC_ALPHA / ONE_MINUS_SRC_ALPHA blending
```

### Per-frame loop

```
stepHeatDiffusion(src, dst, config)  ← CPU Jacobi on Float32Array ping-pong
gl.texImage2D(TEXTURE_2D, 0, R32F, w, h, 0, RED, FLOAT, dst)  ← full texture upload
draw()  ← fullscreen triangle, fragment shader samples R32F texture
```

The fragment shader reads the single-channel float from the `R32F` texture and passes it
through the same `heatColor()` ramp used in the WGSL render shader.

### WebGL texture binding

```
uniform sampler2D u_temp;      // R32F temperature texture (unit 0)
uniform float     u_minTemp;
uniform float     u_maxTemp;
uniform float     u_opacity;
```

---

## 7. Heatmap Color Ramp

Both WGSL and GLSL implement identical piecewise-linear colour ramps.  The normalised
temperature `t ∈ [0, 1]` maps to:

| Range | Colour transition |
|---|---|
| 0.00 – 0.25 | Dark blue → cyan |
| 0.25 – 0.50 | Cyan → green |
| 0.50 – 0.75 | Green → yellow |
| 0.75 – 1.00 | Yellow → red |

The TypeScript helper `temperatureToRgba()` in `heatEquation.ts` replicates this ramp for
CPU-side usage (e.g. tests, canvas export).

---

## 8. React Component Lifecycle

`HeatDiffusionOverlay` (`src/components/venue/floorplan/HeatDiffusionOverlay.tsx`) manages
the engine lifetime through React hooks.

### Mount

```
useEffect (deps: width, height, gridWidth, gridHeight, sensors)
  ├─ canvas.width  = width
  ├─ canvas.height = height
  ├─ if navigator.gpu → new HeatDiffusionEngine → initialize() → start()
  │     └─ on failure → engine.destroy() → fall through to WebGL
  └─ else → startFallback() → new HeatDiffusionFallback → initialize() → start()
```

### Unmount / deps change

The `useEffect` cleanup function sets a `cancelled` flag and calls `tearDown()`:

```typescript
const tearDown = useCallback(() => {
  engineRef.current?.destroy();
  fallbackRef.current?.destroy();
  engineRef.current = null;
  fallbackRef.current = null;
}, []);
```

`destroy()` on both engine types stops the `requestAnimationFrame` loop and releases all GPU
resources (buffers, textures, programs, devices).

### User controls

| Control | Action |
|---|---|
| Pause / Play | `engine.stop()` / `engine.start()` via `togglePause` |
| Reset | `tearDown()` then re-runs the full mount sequence with `handleReset` |

### Mode indicator

The `mode` state (`"detecting" | "WebGPU" | "WebGL 2.0"`) is displayed in the component
header so users can see which rendering path is active.

---

## 9. Rust / WASM Build Pipeline

The `wasm/heat-diffusion/` directory contains a Rust crate that exports an accelerated Jacobi
step callable from JavaScript via `wasm-bindgen`.

### Directory layout

```
wasm/heat-diffusion/
├── Cargo.toml
├── Cargo.lock
└── src/
    └── lib.rs
```

### `Cargo.toml`

```toml
[package]
name = "heat_diffusion"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]  # cdylib → .wasm; rlib → native tests

[dependencies]
wasm-bindgen = "0.2.84"
```

### Exported WASM function

```rust
#[wasm_bindgen]
pub fn calculate_heat_diffusion(
    input: &mut [f32],
    output: &mut [f32],
    width: u32,
    height: u32,
    alpha: f32,
    dt: f32,
    ambient: f32,
    sensors_flat: &[f32],  // interleaved [x, y, temp, x, y, temp, …]
)
```

Sensors are passed as a flat `f32` slice with stride 3 (`x`, `y`, `temperature`) to avoid
the overhead of serialising struct arrays across the WASM boundary.

### Build steps

Prerequisites: [Rust toolchain](https://rustup.rs/), [wasm-pack](https://rustwasm.github.io/wasm-pack/).

```bash
# Install wasm-pack (one-time)
cargo install wasm-pack

# Build for web target (outputs to wasm/heat-diffusion/pkg/)
cd wasm/heat-diffusion
wasm-pack build --target web --release

# The generated package exports:
#   pkg/heat_diffusion_bg.wasm  – the compiled WASM binary
#   pkg/heat_diffusion.js       – JS glue generated by wasm-bindgen
#   pkg/heat_diffusion.d.ts     – TypeScript types
```

### Importing in JavaScript / TypeScript

```typescript
import init, { calculate_heat_diffusion } from "@/wasm/heat-diffusion/pkg/heat_diffusion.js";

await init(); // load + compile the .wasm binary once

const gridA = new Float32Array(width * height).fill(ambient);
const gridB = new Float32Array(width * height);
const sensorFlat = new Float32Array([16, 12, 28,  48, 19, 19]); // 2 sensors

calculate_heat_diffusion(gridA, gridB, width, height, alpha, dt, ambient, sensorFlat);
// gridB now holds the updated temperatures
```

### WASM memory model

`wasm-bindgen` passes `Float32Array` views directly into the WASM linear memory without
copying when the array lives in the same `ArrayBuffer`.  For large grids this avoids a
round-trip allocation.  If the WASM heap grows and the backing `ArrayBuffer` is detached,
`wasm-bindgen` transparently re-creates the view.

---

## 10. Web Worker Message Passing

For grids larger than 128 × 128 the Jacobi iteration can be offloaded to a `Worker` so it
does not block the main thread.  The recommended message protocol is:

```
Main thread                         Worker
──────────────────────────────────────────────────────
postMessage({ type: "init",         ←
  width, height, alpha, dt,
  ambient, sensors })

                                    initialise Float32Arrays
                                    load WASM module

postMessage({ type: "step" })       ←  (each animation frame)

                                    calculate_heat_diffusion(...)
                                    →  postMessage({ type: "frame",
                                         buffer: gridB.buffer },
                                         [gridB.buffer])   // transfer

receive transferred ArrayBuffer     ←
wrap in new Float32Array
upload to WebGL R32F texture
```

Transferring the `ArrayBuffer` (instead of copying it) gives O(1) handoff regardless of grid
size.  After transfer the worker must allocate a fresh `Float32Array` for the next step.

---

## 11. Benchmarking

### Comparing WebGPU, WebGL fallback, and JS/WASM

Open the browser DevTools **Performance** panel or use `performance.now()` around the step
function to measure frame time.

```typescript
// Quick microbenchmark (main-thread JS Jacobi)
const N = 500;
const src = createAmbientGrid(64, 64, 22, sensors);
const dst = new Float32Array(64 * 64);
const t0 = performance.now();
for (let i = 0; i < N; i++) stepHeatDiffusion(src, dst, config);
console.log(`JS Jacobi avg: ${(performance.now() - t0) / N} ms`);
```

```typescript
// WASM equivalent
await init();
const t0 = performance.now();
for (let i = 0; i < N; i++) calculate_heat_diffusion(src, dst, 64, 64, 0.15, 1, 22, sensors_flat);
console.log(`WASM Jacobi avg: ${(performance.now() - t0) / N} ms`);
```

### Expected relative performance

| Path | Grid 64×64 | Grid 128×128 | Notes |
|---|---|---|---|
| WebGPU compute | < 0.1 ms | < 0.2 ms | GPU parallel, negligible CPU cost |
| WASM Jacobi | ~ 0.3 ms | ~ 1.2 ms | ~3-4× faster than JS on typical hardware |
| JS Jacobi | ~ 1 ms | ~ 4 ms | Pure TypeScript, no SIMD |

### Chrome WebGPU timestamp queries

```typescript
// Enable timestamp queries in Chrome (requires --enable-dawn-features=allow_unsafe_apis)
const querySet = device.createQuerySet({ type: "timestamp", count: 2 });
// pass querySet to encoder.beginComputePass({ timestampWrites: [...] })
// resolve via resolveQuerySet + readback
```

### WebGL profiling with `EXT_disjoint_timer_query_webgl2`

```typescript
const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
if (ext) {
  const query = gl.createQuery();
  gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
  // ... draw call ...
  gl.endQuery(ext.TIME_ELAPSED_EXT);
  // poll on next frame: gl.getQueryParameter(query, gl.QUERY_RESULT)
}
```
