# Web Worker Venue Layout Optimization Pipeline

This document describes the architecture of the two Web Workers that handle venue layout computation in WorkSphere, explains why off-main-thread execution is necessary, and provides guidance for adding custom layout constraints.

---

## Table of Contents

1. [Why a Web Worker](#why-a-web-worker)
2. [Worker Files Overview](#worker-files-overview)
3. [Worker Initialization](#worker-initialization)
4. [Message Protocol](#message-protocol)
   - [layoutWorker.ts — Mesh Generation](#layoutworkerts--mesh-generation)
   - [layoutOptimizer.worker.ts — Desk Placement Optimization](#layoutoptimizerworkerts--desk-placement-optimization)
5. [Layout Algorithm](#layout-algorithm)
   - [3D Mesh Construction (layoutWorker)](#3d-mesh-construction-layoutworker)
   - [AI-Guided Desk Placement (layoutOptimizer)](#ai-guided-desk-placement-layoutoptimizer)
   - [Collision Detection and Node Placement](#collision-detection-and-node-placement)
6. [Data Serialization — Transferable ArrayBuffers](#data-serialization--transferable-arraybuffers)
7. [Applying Results to the React Component](#applying-results-to-the-react-component)
8. [Error Handling](#error-handling)
9. [Adding Custom Layout Constraints](#adding-custom-layout-constraints)

---

## Why a Web Worker

Venue floor plans contain potentially hundreds of seats, walls, and geometry nodes. Computing vertex buffers for WebGPU/WebGL and running an ONNX inference session for desk-placement optimization are both CPU-intensive operations. Performing them on the main thread would:

- Block the browser's rendering pipeline, causing dropped frames and janky UI.
- Delay React's reconciliation loop, making interactive controls (zoom, rotate, toolbar buttons) unresponsive during computation.
- Hold JavaScript's single-threaded event loop, preventing network requests and user input from being processed.

By moving this work into dedicated Web Workers, the main thread stays free to handle rendering and user interaction while the heavy computation proceeds in parallel on a separate OS thread.

---

## Worker Files Overview

| File | Purpose |
|------|---------|
| `src/workers/layoutWorker.ts` | Converts `FloorPlanData` into WebGPU vertex/index buffers and WebGL position/color arrays for 3D rendering. |
| `src/workers/layoutOptimizer.worker.ts` | Runs an ONNX model (or a heuristic fallback) to suggest optimal desk positions and quiet zones given a 2-D floor-plan grid. |

The workers are consumed by:

- `src/components/venue/floorplan/FloorPlan3D.tsx` — uses `layoutWorker` to build and display the 3-D scene.
- `src/hooks/useLayoutOptimizer.ts` — wraps `layoutOptimizer.worker` in a React hook exposing `optimize`, `recommendation`, `isOptimizing`, and `error`.

---

## Worker Initialization

### layoutWorker (FloorPlan3D component)

The worker is instantiated inside a `useEffect` after the `WebGPUFloorPlanRenderer` finishes its async `initialize()` call:

```ts
// src/components/venue/floorplan/FloorPlan3D.tsx
worker = new Worker(
  new URL("../../../workers/layoutWorker.ts", import.meta.url),
);
```

The `import.meta.url`-based constructor lets the bundler (Vite / webpack) resolve the worker file at build time and emit it as a separate chunk. No `{ type: "module" }` option is needed because this worker uses a script-style global `self.addEventListener`.

The worker is terminated in the `useEffect` cleanup:

```ts
return () => {
  worker?.terminate();
  // ...
};
```

### layoutOptimizer.worker (useLayoutOptimizer hook)

The optimizer worker is created once per hook mount with `type: "module"` because the file uses ES module imports (`onnxruntime-web`):

```ts
// src/hooks/useLayoutOptimizer.ts
const worker = new Worker(
  new URL("../workers/layoutOptimizer.worker.ts", import.meta.url),
  { type: "module" },
);
```

Inside the worker, the ONNX `InferenceSession` is initialized lazily on the first `OPTIMIZE` message, not at module load time. This avoids a slow startup penalty for pages that import the hook but do not immediately call `optimize()`.

A guard flag `modelInitializationAttempted` ensures the ONNX initialization is attempted exactly once, even under concurrent requests:

```ts
let session: ort.InferenceSession | null = null;
let modelInitializationAttempted = false;

async function initModel(): Promise<void> {
  if (session || modelInitializationAttempted) return;
  modelInitializationAttempted = true;
  // ...
}
```

---

## Message Protocol

### layoutWorker.ts — Mesh Generation

#### Request (main thread → worker)

```ts
type LayoutWorkerRequest = {
  type: "CALCULATE_LAYOUT";
  data: FloorPlanData;
};
```

`FloorPlanData` is defined in `src/lib/webgpu/floorPlanRenderer.ts`:

```ts
interface FloorPlanData {
  width: number;          // floor width in world units
  depth: number;          // floor depth in world units
  height: number;         // ceiling height in world units
  seats: Array<{
    x: number;
    z: number;
    type: "hot_desk" | "fixed_desk" | "meeting_room" | "phone_booth";
    hasPower: boolean;
    isQuiet: boolean;
  }>;
  walls: Array<{
    x1: number; z1: number;   // wall start point
    x2: number; z2: number;   // wall end point
    height: number;
  }>;
}
```

The request is sent without transfer — `FloorPlanData` contains plain objects, not binary buffers, so a structured-clone copy is acceptable here.

#### Response (worker → main thread)

```ts
type LayoutWorkerResponse = {
  type: "LAYOUT_COMPLETE";
  webgpu: {
    vertices: Float32Array;  // interleaved: position(3) + normal(3) + color(3) + uv(2) = 10 floats per vertex
    indices: Uint16Array;
    indexCount: number;
  };
  webgl: {
    positions: Float32Array; // flat XYZ triples
    colors: Float32Array;    // flat RGB triples (one per vertex)
  };
};
```

The four `ArrayBuffer` objects backing these typed arrays are transferred (zero-copy):

```ts
self.postMessage(response, {
  transfer: [
    webgpu.vertices.buffer,
    webgpu.indices.buffer,
    webgl.positions.buffer,
    webgl.colors.buffer,
  ],
});
```

---

### layoutOptimizer.worker.ts — Desk Placement Optimization

#### Request (main thread → worker)

```ts
type LayoutWorkerRequest = {
  type: "OPTIMIZE";
  sequenceId: number;                    // monotonically increasing counter for stale-response detection
  payload: {
    floorPlanGridBuffer: ArrayBuffer;    // Float32Array buffer: row-major occupancy map (0 = free, 1 = occupied)
    width: number;                       // grid columns
    height: number;                      // grid rows
    deskCount: number;                   // number of desks to place
    powerOutlets: { x: number; y: number }[];  // grid coordinates of power outlets
  };
};
```

The `floorPlanGridBuffer` is sent as a `Transferable`:

```ts
worker.postMessage(message, [floorPlanGrid.buffer as ArrayBuffer]);
```

This transfers ownership of the buffer to the worker, avoiding an O(n) copy for large floor plans.

#### Response (worker → main thread)

**Success:**

```ts
type LayoutWorkerSuccess = {
  type: "SUCCESS";
  sequenceId: number;
  payload: {
    deskCoordinatesBuffer: ArrayBuffer;       // Float32Array: [x, y, orientation] × deskCount
    quietZoneCoordinatesBuffer: ArrayBuffer;  // Float32Array: [x, y, radius] × zoneCount
    score: number;                            // 0.0–1.0 layout quality score
  };
};
```

**Error:**

```ts
type LayoutWorkerFailure = {
  type: "ERROR";
  sequenceId: number;
  error: string;
};
```

Both result buffers are transferred back to the main thread:

```ts
self.postMessage(response, {
  transfer: [deskCoordinates.buffer, quietZoneCoordinates.buffer],
});
```

---

## Layout Algorithm

### 3D Mesh Construction (layoutWorker)

`layoutWorker.ts` builds the full vertex/index geometry entirely on the worker thread. The pipeline is:

1. **Floor quad** (`createFloorMesh`) — A single axis-aligned quad spanning `[-width/2, width/2]` × `[-depth/2, depth/2]` at y = 0. Color: `rgb(0.15, 0.15, 0.18)`.

2. **Wall faces** (`createWallMesh`) — For each wall segment `(x1,z1)→(x2,z2)` a vertical quad is emitted. The face normal is derived from the perpendicular of the direction vector:
   ```
   normal.x = -(z2 - z1) / length
   normal.z =  (x2 - x1) / length
   ```

3. **Seat meshes** (`createSeatMesh`) — Each seat becomes a 3-D box. Height (`h`) depends on type: `phone_booth` → 1.8 units, all others → 0.05 units. The box is assembled from 5 faces (no bottom face). If `seat.hasPower === true`, a small yellow indicator cube is placed on top.

   Seat type colors (normalized RGB):
   | Type | R | G | B |
   |------|---|---|---|
   | `hot_desk` | 0.2 | 0.6 | 0.9 |
   | `fixed_desk` | 0.3 | 0.8 | 0.4 |
   | `meeting_room` | 0.8 | 0.5 | 0.2 |
   | `phone_booth` | 0.7 | 0.3 | 0.7 |

4. **Vertex layout** — Each vertex occupies 10 `float32` values:
   ```
   [posX, posY, posZ, normX, normY, normZ, r, g, b, u, v]
   ```
   Indices are `Uint16` (up to 65 535 vertices per draw call).

5. **WebGL fallback** (`computeWebGLFallback`) — A simpler flat-triangle representation without normals or UVs is also computed in parallel. This is used when the browser does not support WebGPU.

### AI-Guided Desk Placement (layoutOptimizer)

`layoutOptimizer.worker.ts` uses an ONNX model (`/models/layout_optimizer.onnx`) to propose desk coordinates from a 2-D grid representation of the floor plan.

**Input tensor shape:** `[1, 1, height, width]` (batch=1, channel=1, spatial dimensions)

**Output tensor:** A flat `Float32Array` of length `deskCount × 3`. Each triplet encodes `[x, y, orientation]` for one desk.

**Quiet zone derivation:** A single quiet zone is placed at the floor-plan centroid `(width/2, height/2)` with radius `max(2, min(width, height) / 10)`.

### Collision Detection and Node Placement

The heuristic fallback (used when the ONNX model file is unavailable) implements a simple proximity-to-outlet strategy to avoid desk clustering:

```
For desk[i]:
  outlet = powerOutlets[i % powerOutlets.length]
  offset = floor(i / powerOutlets.length) + 1
  x = clamp(outlet.x + (i is even ? +offset : -offset), 0, width-1)
  y = clamp(outlet.y, 0, height-1)
  orientation = i is even ? 0 : π
```

When no power outlets are provided, desks fall back to a grid arrangement:

```
columns = ceil(sqrt(deskCount))
x = i % columns
y = floor(i / columns)
```

Both paths clamp coordinates to `[0, width-1]` × `[0, height-1]` to prevent out-of-bounds placement.

---

## Data Serialization — Transferable ArrayBuffers

Both workers use the [Transferable Objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects) mechanism (`postMessage(data, [transfer])`) to move typed array buffers between threads without copying:

| Buffer | Type | Contents |
|--------|------|----------|
| `webgpu.vertices.buffer` | `Float32Array` | Interleaved vertex data (10 floats/vertex) |
| `webgpu.indices.buffer` | `Uint16Array` | Triangle index list |
| `webgl.positions.buffer` | `Float32Array` | Flat XYZ vertex positions |
| `webgl.colors.buffer` | `Float32Array` | Flat RGB per-vertex colors |
| `floorPlanGridBuffer` | `Float32Array` | Row-major occupancy grid |
| `deskCoordinatesBuffer` | `Float32Array` | Desk placements `[x, y, θ] × N` |
| `quietZoneCoordinatesBuffer` | `Float32Array` | Quiet zones `[x, y, r] × M` |

**Important:** After a buffer is transferred, the sender's `ArrayBuffer` becomes detached (`.byteLength === 0`). Always create a fresh `Float32Array` copy before transferring if the original array is still needed on the sending side. The `useLayoutOptimizer` hook does this defensively:

```ts
const floorPlanGrid =
  request.floorPlanGrid instanceof Float32Array
    ? new Float32Array(request.floorPlanGrid)   // copy; original stays intact
    : Float32Array.from(request.floorPlanGrid);
```

---

## Applying Results to the React Component

### FloorPlan3D (layoutWorker results)

The component's `worker.onmessage` handler branches on GPU capability:

```ts
worker.onmessage = (event) => {
  if (event.data.type === "LAYOUT_COMPLETE") {
    const { webgpu, webgl } = event.data;

    if (success) {                           // WebGPU available
      setUseWebGPU(true);
      renderer.loadFloorPlanMesh(webgpu);    // uploads buffers to GPU
      renderer.startRenderLoop();
    } else {                                 // WebGL fallback
      fallbackCleanup = renderWebGLFallback(canvas, data, webgl);
    }
  }
};
```

The `webgpu` mesh is uploaded to the GPU via `WebGPUFloorPlanRenderer.loadFloorPlanMesh()`, which creates `GPUBuffer` objects for vertices and indices. The `webgl` fallback is rendered immediately as a static snapshot using `gl.drawArrays(gl.TRIANGLES, …)`.

A `useWebGPU` state boolean controls the subtitle badge in the component header: `"WebGPU accelerated"` vs `"WebGL 2.0 fallback"`.

### useLayoutOptimizer hook (layoutOptimizer results)

The hook deserializes the two transferred buffers back into typed arrays:

```ts
function deserializeRecommendation(response): LayoutRecommendation {
  const deskCoordinates = new Float32Array(response.payload.deskCoordinatesBuffer);
  const quietZoneCoordinates = new Float32Array(response.payload.quietZoneCoordinatesBuffer);

  const desks = [];
  for (let i = 0; i < deskCoordinates.length; i += 3) {
    desks.push({ x: deskCoordinates[i], y: deskCoordinates[i+1], orientation: deskCoordinates[i+2] });
  }
  // ... similar for quiet zones
  return { desks, quietZones, score: response.payload.score };
}
```

A `sequenceId` monotonic counter handles race conditions when `optimize()` is called in quick succession. Responses whose `sequenceId` is less than `activeSequenceIdRef.current` are silently dropped, so only the most recent request's result is applied:

```ts
if (activeSequenceIdRef.current !== null &&
    message.sequenceId < activeSequenceIdRef.current) {
  return; // stale response — discard
}
```

The hook exposes four values:

| Value | Type | Description |
|-------|------|-------------|
| `optimize` | `(request: LayoutRequest) => void` | Triggers a new optimization run |
| `recommendation` | `LayoutRecommendation \| null` | Latest successful result |
| `isOptimizing` | `boolean` | True while a request is in flight |
| `error` | `string \| null` | Last error message, or null |

---

## Error Handling

### layoutWorker

The worker does not have a `try/catch` block; it performs no I/O and cannot throw under normal operation. If a fatal error occurs (e.g., out-of-memory during large mesh allocation), the browser fires the `worker.onerror` event, which terminates the effect and unmounts the canvas gracefully.

WebGL context loss is handled separately by `attachWebGLContextRecovery` in `FloorPlan3D.tsx`, which re-renders the fallback mesh on `webglcontextrestored`.

### layoutOptimizer.worker

All top-level logic is wrapped in a `try/catch`:

```ts
try {
  // validate → initModel → optimizeLayout → serialize → postMessage(SUCCESS)
} catch (error) {
  self.postMessage({
    type: "ERROR",
    sequenceId: message.sequenceId,
    error: error instanceof Error ? error.message : "Layout optimization failed.",
  });
}
```

Validation errors (e.g., `width <= 0`, grid size mismatch) throw `Error` with human-readable messages and are surfaced to the React component via the `error` state.

ONNX model load failures are non-fatal: a `console.warn` is emitted and the heuristic fallback is used transparently. The `score` field in the fallback response is `0.5` (vs `0.92` for the model path), allowing callers to detect which path ran.

The `worker.onerror` handler in `useLayoutOptimizer` catches unexpected worker crashes:

```ts
worker.onerror = () => {
  setError("The layout optimization worker stopped unexpectedly.");
  setIsOptimizing(false);
};
```

---

## Adding Custom Layout Constraints

To introduce a new constraint (e.g., minimum distance between desks, accessibility aisle clearance), follow these steps:

### 1. Extend LayoutRequest

Add your constraint parameters to `LayoutRequest` in `layoutOptimizer.worker.ts`:

```ts
export type LayoutRequest = {
  // ... existing fields ...
  minDeskSpacing?: number;       // minimum grid units between any two desks
  aisleWidth?: number;           // reserved clearance along room edges
};
```

Update the message payload type `LayoutWorkerRequest` to pass the new field through `payload`.

### 2. Validate in validateRequest

Add validation logic alongside the existing checks:

```ts
if (request.minDeskSpacing !== undefined && request.minDeskSpacing < 0) {
  throw new Error("minDeskSpacing must be a non-negative number.");
}
```

### 3. Apply in the heuristic fallback

Modify `fallbackLayout` to enforce the constraint before committing a desk position. For a spacing constraint, maintain a list of placed positions and reject candidates within `minDeskSpacing` units:

```ts
const placed: { x: number; y: number }[] = [];

function isTooClose(x: number, y: number, minSpacing: number): boolean {
  return placed.some(p => Math.hypot(p.x - x, p.y - y) < minSpacing);
}
```

### 4. Pass constraints to the ONNX model (if applicable)

If the model supports conditioning inputs, add extra channels to the `inputTensor` or use a separate named input. Consult the model's `.onnx` graph for accepted input names using a tool such as [Netron](https://netron.app/).

### 5. Add a test

Tests live in `src/__tests__/hooks/useLayoutOptimizer.test.ts`. Add a case that passes your new parameter and asserts the constraint is reflected in the recommendation.

---

*For renderer-side documentation see [`docs/WEBGPU_3D_FLOOR_PLAN_MANUAL.md`](WEBGPU_3D_FLOOR_PLAN_MANUAL.md). For general Web Worker infrastructure see [`docs/WEB_WORKERS_SYNC_INFRASTRUCTURE.md`](WEB_WORKERS_SYNC_INFRASTRUCTURE.md).*
