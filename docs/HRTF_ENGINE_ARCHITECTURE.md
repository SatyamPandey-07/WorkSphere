# Architectural Specification: HRTF WebAssembly Engine (`hrtf_engine.cpp`)

## 1. Executive Summary & Overview

The `hrtf_engine.cpp` C++ module located in `src/wasm/` delivers high-performance 3D spatial audio processing for WorkSphere's collaborative real-time environment. By executing Head-Related Transfer Function (HRTF) calculations directly inside a WebAssembly runtime, the engine spatializes multi-user audio streams over headphones with sub-millisecond latency.

The module incorporates:

- **Interaural Time Difference (ITD)** modeling via Woodworth delay formulation.
- **Interaural Level Difference (ILD)** frequency-dependent acoustic head shadowing.
- **FIR Impulse Response Convolution** using direct time-domain SIMD vectorization (`wasm_simd128.h`) and overlap-add tail preservation.
- **Inverse Distance Attenuation Model** for realistic 3D distance rendering.
- **16-Byte Aligned Heap Allocation** to prevent WebAssembly memory misalignment faults.

---

## 2. Dockerfile & Emscripten Compilation Toolchain Setup

The WebAssembly binary (`hrtf_engine.wasm`) and JavaScript loader (`hrtf_engine.js`) are compiled using a multi-stage Docker build pipeline based on Emscripten (`emscripten/emsdk:3.1.50`).

### 2.1 Multi-Stage `Dockerfile` (`src/wasm/Dockerfile`)

```dockerfile
# Stage 1: Build environment using official Emscripten SDK
FROM emscripten/emsdk:3.1.50 AS wasm-builder
WORKDIR /build

COPY src/wasm/hrtf_engine.cpp ./hrtf_engine.cpp
RUN mkdir -p /build/output

RUN emcc hrtf_engine.cpp \
    -O3 \
    -msimd128 \
    -s WASM=1 \
    -s EXPORTED_FUNCTIONS='["_malloc_scratch_buffer", "_free_scratch_buffer", "_process_hrtf_block", "_set_hrtf_simd_enabled", "_malloc", "_free"]' \
    -s EXPORTED_RUNTIME_METHODS='["cwrap", "setValue", "getValue", "HEAPF32"]' \
    -s INITIAL_MEMORY=6553600 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s ENVIRONMENT='web,worker' \
    -s MODULARIZE=1 \
    -s EXPORT_NAME='createHrtfEngineModule' \
    -o /build/output/hrtf_engine.js

# Stage 2: Artifact export stage
FROM alpine:3.19 AS artifact-exporter
WORKDIR /dist
COPY --from=wasm-builder /build/output/hrtf_engine.wasm ./public/wasm/hrtf_engine.wasm
COPY --from=wasm-builder /build/output/hrtf_engine.js ./public/wasm/hrtf_engine.js
```

### 2.2 Key Emscripten Flags & Rationale

| Flag                          | Purpose / Technical Rationale                                                               |
| :---------------------------- | :------------------------------------------------------------------------------------------ |
| `-O3`                         | Enables aggressive LLVM vectorization, loop unrolling, and dead code elimination.           |
| `-msimd128`                   | Emits WebAssembly 128-bit SIMD instructions (`v128_t`, `wasm_f32x4_add`, `wasm_f32x4_mul`). |
| `-s WASM=1`                   | Outputs standalone WebAssembly bytecode (`.wasm`).                                          |
| `-s EXPORTED_FUNCTIONS`       | Prevents symbol stripping for `malloc_scratch_buffer` and `process_hrtf_block`.             |
| `-s EXPORTED_RUNTIME_METHODS` | Exposes `HEAPF32` typed array view and `cwrap` helper for JavaScript interoperability.      |
| `-s INITIAL_MEMORY=6553600`   | Pre-allocates 6.5 MB of initial linear memory (100 WASM memory pages).                      |
| `-s ALLOW_MEMORY_GROWTH=1`    | Allows linear memory expansion if concurrent audio channels increase.                       |

---

## 3. C++ Export Functions & Memory Architecture

The C++ module exposes low-level memory allocation and processing entrypoints to JavaScript via C linkage (`extern "C"`).

```cpp
extern "C" {
    void* malloc_scratch_buffer(int size_bytes);
    void free_scratch_buffer(void* ptr);
    void set_hrtf_simd_enabled(int enabled);
    int process_hrtf_block(
        const float* input,
        float* left_output,
        float* right_output,
        int num_samples,
        float azimuth,
        float elevation,
        float distance
    );
}
```

### 3.1 `malloc_scratch_buffer(int size_bytes)`

- **Description**: Allocates a 16-byte aligned memory region on the WebAssembly heap.
- **Alignment Requirement**: 16-byte alignment (`posix_memalign(&ptr, 16, size_bytes)`) is mandatory for 128-bit SIMD loads (`wasm_v128_load`). Loading unaligned memory via SIMD causes runtime alignment trap faults on ARM32 architectures.
- **Returns**: A pointer `void*` to the allocated heap offset (in bytes).

### 3.2 `free_scratch_buffer(void* ptr)`

- **Description**: Deallocates the scratch buffer from WebAssembly memory, preventing heap leaks during AudioWorklet processor teardown.

### 3.3 `set_hrtf_simd_enabled(int enabled)`

- **Description**: Runtime feature flag to enable (`1`) or disable (`0`) 128-bit SIMD vectorization. Provides scalar fallback protection for non-SIMD devices.

### 3.4 C++ Struct Layout for Binaural Filters

To optimize cache locality and guarantee proper alignment for SIMD registers, the impulse response and overlap-add state are tightly packed into a 16-byte aligned struct:

```cpp
// 16-byte aligned structure for SIMD processing efficiency
struct alignas(16) BinauralFilterState {
    // Current FIR filter kernel (max 128 taps)
    float left_impulse_response[128];
    float right_impulse_response[128];

    // Overlap-add ring buffers for seamless frame transitions
    float left_overlap_state[128];
    float right_overlap_state[128];

    int filter_length;
};
```

---

## 4. HRTF Binaural Impulse Response Convolution Algorithms

### 4.1 Interaural Time Difference (ITD) & Woodworth Model

The horizontal position (azimuth $\theta$) dictates the arrival time difference between the left and right ears:

$$\text{ITD} = \frac{r}{c} \cdot (\sin\theta + \theta)$$

Where:

- $r = 0.0875\text{ m}$ (average human head radius)
- $c = 343\text{ m/s}$ (speed of sound in air)

The ITD is converted to sample delays $\Delta t = \text{ITD} \cdot f_s$ and applied by offsetting the sinc impulse peak within the FIR filter kernel.

### 4.2 Interaural Level Difference (ILD) Head Shadowing

Acoustic head shadowing attenuates high frequencies for the ear opposing the sound source:

$$\text{ILD}_{\text{left}} = \frac{1}{2} (1 - \sin\theta), \quad \text{ILD}_{\text{right}} = \frac{1}{2} (1 + \sin\theta)$$

### 4.3 Direct Time-Domain FIR Convolution & Overlap-Add

Each audio frame undergoes Finite Impulse Response (FIR) filtering with the synthetic HRTF kernel $h[k]$:

$$y[n] = \sum_{k=0}^{K-1} x[n - k] \cdot h[k]$$

To maintain continuous phase without clicks across AudioWorklet block boundaries, the remaining filter tail is stored in `left_overlap` and `right_overlap` arrays and summed into the leading samples of the subsequent block.

### 4.4 SIMD Vectorization (`wasm_simd128.h`)

Convolution inner loops use WebAssembly 128-bit SIMD intrinsics to process 4 32-bit floating-point operations in parallel:

```cpp
v128_t in_v = wasm_v128_load(&input[n - k - 3]);
v128_t filt_v = wasm_v128_load(&filter[k]);
sum_v = wasm_f32x4_add(sum_v, wasm_f32x4_mul(in_v, filt_v));
```

### 4.5 Distance Attenuation Model

Distance attenuation follows the 1/r Inverse Distance Law:

$$\text{Gain} = \min\left(1.0, \frac{d_{\text{ref}}}{\max(d, d_{\text{ref}})}\right)$$

Where $d_{\text{ref}} = 1.0\text{ m}$.

---

## 5. AudioWorklet Shared Memory Synchronization Model

To prevent main-thread garbage collection (GC) pauses from causing audible dropouts, the architecture utilizes a lock-free `SharedArrayBuffer` (SAB) pipeline to sync spatial parameters (azimuth, elevation, distance) to the `AudioWorkletProcessor`.

1. **Parameter Buffer**: A `Float32Array` mapped over a `SharedArrayBuffer` is instantiated on the main UI thread.
2. **Atomic Writes**: When the user moves their avatar, the main thread writes new spatial coordinates to the SAB using `Atomics.store()`.
3. **Wait-Free Reads**: The AudioWorklet pulls the latest values from the SAB via `Atomics.load()` at the start of every 128-sample render quantum.
4. **Zero-Message Latency**: This eliminates the need for `postMessage()` events, reducing parameter sync latency to $< 0.1$ ms and avoiding memory allocation on the audio thread entirely.

---

## 6. WebAssembly Heap Layout & Alignment Protocol

```
+-----------------------------------------------------------------------+
| WASM Linear Memory (HEAPF32)                                          |
+------------------------------------+----------------------------------+
| Scratch Input Buffer (Mono PCM)    | Left Output Buffer (Binaural)    |
| Pointer: input_ptr (16-byte align) | Pointer: left_ptr (16-byte align)|
+------------------------------------+----------------------------------+
| Right Output Buffer (Binaural)     | Static Overlap States & Memory   |
| Pointer: right_ptr (16-byte align) | left_overlap / right_overlap     |
+------------------------------------+----------------------------------+
```

---

## 7. Verification & Test Plan

Automated test suites in `src/__tests__/wasm/hrtfEngine.test.ts` validate:

1. Memory buffer allocation and 16-byte pointer alignment.
2. FIR convolution correctness under both SIMD and scalar dispatch modes.
3. Azimuth and elevation spatial panning gain distribution.
4. Inverse distance attenuation scaling.
5. `SharedArrayBuffer` atomic synchronization boundaries.
