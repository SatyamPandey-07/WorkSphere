# Runbook: Triaging WebGPU Device Loss and Compute Fallback Events

**Audience:** contributors and maintainers working on spatial / WebGPU features.
**Scope:** how WorkSphere falls back when WebGPU is unavailable or fails, how to reproduce each fallback locally, and how to read the fallback signals.

Primary implementation: `src/core/gpu/MeshDecimatorCompute.ts` (LiDAR mesh decimation with automatic CPU fallback). Related docs: [WebGPU mesh decimation](../spatial/WEBGPU_MESH_DECIMATION.md), [WebGPU acoustic ray-trace pipeline](../spatial/WEBGPU_ACOUSTIC_RAYTRACE_PIPELINE.md), [WebRTC ICE recovery runbook](WEBRTC_ICE_RECOVERY.md).

---

## 1. Why this exists

WebGPU is not available everywhere. On low-end hardware, old or blocklisted drivers, headless/CI browsers and browsers without `navigator.gpu`, either:

1. **Initialisation fails**: `navigator.gpu` is missing, `requestAdapter()` returns `null`, device limits are too low, or the WGSL shader fails to compile.
2. **The device is lost or fails at runtime**: a driver reset, GPU process crash, or explicit `device.destroy()` makes dispatches fail.

The app must keep working, with reduced performance, instead of failing.

---

## 2. Fallback chain

### 2.1 Target chain (issue #9182)

```
WebGPU Compute -> WebGL -> CPU Worker -> In-memory heuristic
```

### 2.2 What is implemented today

| Tier | Backend                                                  | Implemented in `MeshDecimatorCompute.ts`                                                                   |
| ---- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1    | WebGPU compute (WGSL, adaptive workgroup size)           | Yes (`backend: "webgpu"`)                                                                                  |
| 2    | CPU path (same QEM edge-collapse algorithm, main thread) | Yes (`backend: "cpu"`)                                                                                     |
| 3    | WebGL compute-style fallback                             | No                                                                                                         |
| 4    | Dedicated CPU Web Worker tier                            | No in this module (other features run their own workers, e.g. `useLayoutOptimizer`, `useOffscreenHeatmap`) |
| 5    | In-memory heuristic                                      | No                                                                                                         |

Treat tiers 3 to 5 as the design target for future work. When triaging today, only the WebGPU -> CPU transition exists in this module.

### 2.3 Behaviour rules

- `MeshDecimatorCompute.create()` never throws for a missing or broken GPU. It returns an instance configured for CPU and calls `onFallback(reason)`.
- Fallback is reported through the `onFallback?: (reason: string) => void` option and the `backend` field on the result (`"webgpu" | "cpu"`).
- A failure during a WebGPU decimation call falls back to the CPU path for that call and calls `onFallback`.
- `forceCpu` forces the CPU path even when WebGPU is available (useful for benchmarks and tests).
- The `backend` getter reports `"cpu"` once the decimator has been destroyed.
- Results from a failed GPU run are discarded; the CPU path recomputes the result.

---

## 3. Fallback reasons (`onFallback` messages)

| Message                                                       | Stage | Meaning / first check                                                               |
| ------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------- |
| `CPU execution forced by options`                             | init  | `forceCpu` was set. Expected in tests and benchmarks                                |
| `WebGPU (navigator.gpu) is not supported in this environment` | init  | No WebGPU in this browser/runtime. Check `chrome://gpu`                             |
| `navigator.gpu undefined`                                     | init  | Same cause, second guard                                                            |
| `No compatible WebGPU adapter found`                          | init  | `requestAdapter()` returned `null`: blocklisted GPU/driver, headless runner         |
| `GPU device compute limits below minimum workgroup size 64`   | init  | Device limits too low to run the shader safely                                      |
| `WGSL shader compilation error: <details>`                    | init  | Shader bug or driver incompatibility. Reproduce on another GPU                      |
| `WebGPU initialization failed: <reason>`                      | init  | Any other exception while creating the device or pipelines                          |
| `WebGPU execution failure, falling back to CPU: <error>`      | run   | Dispatch threw: lost device, out-of-memory, or unsupported limits for this workload |

Workgroup size is chosen from triangle count and device limits (64, 128 or 256, capped by `maxComputeWorkgroupSizeX` and `maxComputeInvocationsPerWorkgroup`). If limits cannot support the required size, the GPU path throws and the CPU fallback runs.

### 3.1 `device.lost`

`MeshDecimatorCompute.ts` does not currently subscribe to `device.lost`. A lost device is only noticed when the next dispatch fails (`WebGPU execution failure...`) or after the decimator is destroyed. If you add a `device.lost` handler, route it through the same `onFallback` callback with a reason such as `GPU device lost: <reason> <message>` so one signal covers both paths.

`GPUDeviceLostInfo.reason` is `"destroyed"` for an explicit `device.destroy()` and `"unknown"` for driver or GPU-process loss.

---

## 4. Symptoms and first checks

| Symptom                                     | Likely cause                         | First check                                        |
| ------------------------------------------- | ------------------------------------ | -------------------------------------------------- |
| Decimation is slower than usual but correct | Running on CPU                       | Check `result.backend` and the `onFallback` reason |
| Works on one machine, falls back on another | GPU or driver blocklist              | `chrome://gpu`, "WebGPU" row                       |
| Falls back only in CI / headless            | No adapter in the runner             | Expected; assert the fallback in tests             |
| Works, then falls back mid-session          | Device lost or OOM during a dispatch | Look for `WebGPU execution failure...`             |
| `WGSL shader compilation error`             | Shader or driver issue               | Capture GPU and driver from `chrome://gpu`         |

Collect before escalating: browser and version, OS, GPU and driver, the `onFallback` message(s), triangle count of the input, and whether a reload changes the result.

---

## 5. Reproducing fallbacks locally (Chrome / Edge)

### 5.1 Enable WebGPU on unsupported platforms

Open `chrome://flags/#enable-unsafe-webgpu`, set it to **Enabled**, and relaunch. This lets WebGPU run on platforms or GPUs where it is normally disabled, so you can exercise the primary tier on any machine. Development only; do not use that profile for normal browsing.

Verify in the DevTools console:

```js
const adapter = await navigator.gpu?.requestAdapter();
console.log(adapter ? "WebGPU adapter available" : "No WebGPU adapter");
```

### 5.2 Simulate a device loss

Destroy a device you create yourself and watch `device.lost` resolve:

```js
const adapter = await navigator.gpu.requestAdapter();
const device = await adapter.requestDevice();
device.lost.then((info) =>
  console.warn("device lost:", info.reason, info.message),
);
device.destroy(); // reason: "destroyed"
```

For a genuine driver-level loss, open `chrome://gpucrash` in a **separate tab**. This crashes the GPU process; WebGPU and WebGL contexts in the browser are lost and the next dispatch should fall back to CPU.

### 5.3 Force a specific outcome

| Goal                       | How                                                                                                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Force the CPU path in code | Pass `forceCpu` (expected message: `CPU execution forced by options`)                                                                                                                               |
| Make WebGPU unavailable    | Before the app loads, run `Object.defineProperty(navigator, "gpu", { value: undefined })` from a DevTools Snippet on a blank tab, then navigate in the same tab, or launch with `--disable-3d-apis` |
| No GPU adapter             | Run in a headless/remote session without a GPU                                                                                                                                                      |

PowerShell launch example (adjust the Chrome path):

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --disable-3d-apis --user-data-dir="$env:TEMP\ws-fallback-test" http://localhost:3000
```

A throwaway `--user-data-dir` keeps flags out of your normal profile.

### 5.4 Verify after each simulation

1. `onFallback` fires once with the expected reason.
2. The result is still returned with `backend: "cpu"` and no unhandled rejection.
3. Reloading the page starts again on WebGPU when it is available.
4. No console errors other than the intentional warnings.

---

## 6. Telemetry and error reporting

Today the signals are the `onFallback(reason)` callback and the `backend` field on each result. Consumers that forward them to logging or analytics should use a consistent shape.

### 6.1 Recommended event fields

| Field           | Example                  | Notes                                          |
| --------------- | ------------------------ | ---------------------------------------------- |
| `event`         | `gpu_fallback`           | One event per transition                       |
| `from` / `to`   | `webgpu` / `cpu`         | Tiers left and entered                         |
| `reason`        | the `onFallback` message | Keep the prefix stable (see section 3)         |
| `stage`         | `init` or `run`          | When it happened                               |
| `triangleCount` | `48210`                  | Input size; helps spot memory-related failures |
| `userAgent`     | browser string           | Coarse bucket is enough                        |
| `timestamp`     | ISO-8601                 | Client time                                    |

### 6.2 Metrics worth tracking

- **Fallback rate**: sessions with at least one fallback / total sessions, split by reason.
- **Init vs run failures**: a rising `run` share points to device loss or memory pressure rather than missing hardware.
- **CPU-path share of decimations**: the user-visible performance risk.
- **Time per decimation by backend**: quantifies the cost of falling back.
- **Repeated fallbacks per session**: hints at unstable hardware.

### 6.3 Privacy and noise rules

- Never log mesh data, coordinates, or user identifiers.
- Log one event per fallback, not per frame or per dispatch retry.
- Truncate free-text error messages.
- Treat `CPU execution forced by options` as expected, not as an incident.

---

## 7. Triage checklist

1. Read `result.backend` and the `onFallback` reason.
2. Classify:
   - **Capability gap** (not supported, no adapter, limits too low): expected on that device; act only if the device should be supported.
   - **Shader/driver failure** (WGSL compilation error): reproduce on another GPU and capture the driver.
   - **Runtime failure** (`WebGPU execution failure...`): check for device loss or out-of-memory with large meshes.
3. Reproduce using section 5 and confirm the same message appears.
4. Confirm the user still got a correct result via the CPU path.
5. File or update an issue with browser, OS, GPU and driver, the reason string, input size, and repro steps.

---

## 8. Testing guidance for contributors

- Existing coverage for this module lives in `src/__tests__/core/gpu/MeshDecimatorCompute.test.ts`. Extend it rather than adding a parallel file.
- Mock `navigator.gpu` (`undefined`, `requestAdapter` resolving `null`, `requestDevice` rejecting) and assert the `onFallback` reason and `backend: "cpu"`.
- Do not require a real GPU in Jest; CI runners generally have none. See the [Testing Playbook](../TESTING_PLAYBOOK.md) for mocking conventions.
- Before opening a PR run: `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`.

---

## 9. Quick reference

| I want to...                         | Do this                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| Run WebGPU on an unsupported machine | Enable `chrome://flags/#enable-unsafe-webgpu`, relaunch                      |
| Simulate a lost device               | `device.destroy()` on your own device, or `chrome://gpucrash` in another tab |
| Force the CPU path                   | `forceCpu` option                                                            |
| Make WebGPU unavailable              | Make `navigator.gpu` undefined before load, or `--disable-3d-apis`           |
| Check GPU/driver status              | `chrome://gpu`                                                               |
