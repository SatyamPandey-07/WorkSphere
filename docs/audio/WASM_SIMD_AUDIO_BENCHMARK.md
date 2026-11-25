# WebAssembly SIMD vs Web Audio AnalyserNode Fallback Benchmark Guide

This document specifies the architecture, feature-detection pipeline, mathematical frequency resolution, rendering pipeline, and benchmark methodology for comparing WorkSphere's WebAssembly 128-bit SIMD Fast Fourier Transform (FFT) engine against the native Web Audio API `AnalyserNode` fallback.

---

## 1. Overview

In collaborative workspace environments, real-time acoustic privacy monitoring requires low-latency, high-precision spectral analysis to detect speech leakage, assess room reverberation, and classify background noise. The audio engine continuously evaluates acoustic telemetry to enforce privacy masking and provide users with visual feedback on environmental acoustics.

Key architectural motivations include:
- **Vectorized Acceleration**: Digital signal processing algorithms—specifically windowing, butterfly permutations, complex multiplications, and magnitude conversions—are embarrassingly parallel and benefit substantially from SIMD (Single Instruction, Multiple Data) vectorization.
- **WebAssembly 128-bit SIMD (`wasm_simd128`)**: Enables execution of 4 parallel 32-bit floating-point operations per CPU instruction cycle directly within the browser runtime.
- **Web Audio API `AnalyserNode` Fallback**: Provides a native, hardware-accelerated C++ browser fallback on platforms or web views lacking WebAssembly SIMD support or AudioWorklet availability.
- **Dynamic Capability Detection**: Runtime verification using `WebAssembly.validate` ensures zero runtime crashes on legacy or restricted engines while seamlessly selecting the optimal processing path.
- **Current WorkSphere Scope**: WorkSphere implements both a 2048-point Radix-4 SIMD FFT engine (`src/lib/audio/radix4FftEngine.ts`) for real-time acoustic privacy analysis (#7630), a 512-point/256-bin spectral fallback bridge (`src/lib/audio/spectralFallback.ts`, #8629), and rolling 60fps spectrogram waterfall visualizers in 2D Canvas and WebGL (`NoiseSpectrogram.tsx`, `SpectralWaterfallCanvas.tsx`).

---

## 2. Architecture and Processing Pipeline

The WorkSphere audio processing pipeline routes audio from media devices through capability detection into either the SIMD-accelerated pipeline or the native Web Audio fallback:

```
[ Microphone MediaStream (navigator.mediaDevices.getUserMedia) ]
                             │
                             ▼
               [ AudioContext (48kHz / 44.1kHz) ]
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
   [ AudioWorkletNode / UI ]         [ MediaStreamAudioSourceNode ]
            │                                 │
            ▼                                 ▼
[ SIMD Feature Detection ]           [ AnalyserNode Fallback ]
  (WebAssembly.validate)               - fftSize: 2048 (or 512)
            │                          - smoothingTimeConstant: 0.7
    ┌───────┴───────┐                  - Blackman window
    ▼               ▼                         │
[SIMD Path]   [Scalar Path]                   ▼
- WASM SIMD   - JS Radix-4           [ getFloatFrequencyData ]
- 2048 FFT    - Hann Window          [ getByteFrequencyData  ]
- Hann Win    - Bit Reversal                  │
    │               │                         │
    └───────┬───────┘                         ▼
            ▼                       [ Normalization & Gain ]
    [ FftResult Bins ]              (ANALYSER_TO_WORKLET_SCALE)
            │                                 │
            └────────────────┬────────────────┘
                             ▼
     [ Real-Time Visualization / Waterfall Spectrogram ]
       - 2D Canvas Rolling Buffer (drawWaterfallColumn)
       - WebGL Luminance Texture Scrolling (60fps rAF)
```

### Component Breakdown

| Component | Responsibility | Input | Output | Source File | Implementation Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`Radix4FftEngine`** | 2048-point Radix-4 FFT engine with WASM SIMD and scalar fallback | 2048 `Float32Array` audio samples | `FftResult` (1024 dB bins, dominant frequency, peak dB) | `src/lib/audio/radix4FftEngine.ts` | Implemented |
| **`detectWasmSimd`** | 128-bit SIMD bytecode validation probe | Static bytecode probe (`WASM_SIMD_PROBE_BYTES`) | `boolean` capability flag | `src/lib/audio/spectralFallback.ts` | Implemented |
| **`buildSpectralFrame`** | Normalizes AnalyserNode readouts to match worklet output | AnalyserNode dB & time arrays | `SpectralFrame` (bins, splDb, dominantFrequencyHz) | `src/lib/audio/spectralFallback.ts` | Implemented |
| **`NoiseSpectrogram`** | 60fps Canvas spectrum bars and scrolling waterfall history | AnalyserNode frequency data | 2D Canvas display (`drawWaterfallColumn`) | `src/components/noise/NoiseSpectrogram.tsx` | Implemented |
| **`SpectralWaterfallCanvas`** | Hardware-accelerated WebGL waterfall spectrogram | AnalyserNode or `Uint8Array` FFT data | WebGL texture quad render | `src/components/audio/SpectralWaterfallCanvas.tsx` | Implemented |
| **AudioWorklet SIMD Filter** | In-thread audio processing and filtering | Audio stream channel buffers | Filtered audio stream | `public/worklets/fft-processor.js` | Implemented |
| **Automated Benchmark Runner** | Comprehensive multi-engine comparative benchmark suite | Test tone / chirp audio buffers | Latency, throughput, and CPU profiling metrics | Proposed | Proposed |

---

## 3. WebAssembly SIMD Feature Detection

### Validation Mechanism

WorkSphere does not assume SIMD support from `typeof WebAssembly !== "undefined"`. Instead, it validates a minimal 31-byte WebAssembly binary containing SIMD opcodes via `WebAssembly.validate()`:

```typescript
// Smallest valid WASM module declaring a SIMD operation (i8x16.splat + i8x16.popcnt)
export const WASM_SIMD_PROBE_BYTES = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, // \0asm (magic header)
  0x01, 0x00, 0x00, 0x00, // version 1
  0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b, // Type section
  0x03, 0x02, 0x01, 0x00, // Function section
  0x0a, 0x0a, 0x01, 0x08, 0x00, 0x41, 0x00, // Code section
  0xfd, 0x0f, // i8x16.splat (prefix 0xfd, opcode 15)
  0xfd, 0x62, // i8x16.popcnt (prefix 0xfd, opcode 98)
  0x0b        // end
]);

export function isWasmSimdSupported(): boolean {
  try {
    return (
      typeof WebAssembly === "object" &&
      typeof WebAssembly.validate === "function" &&
      WebAssembly.validate(WASM_SIMD_PROBE_BYTES)
    );
  } catch {
    return false;
  }
}
```

### Detection Layers and Distinctions

1. **JavaScript WebAssembly API Availability**: Verifies `typeof WebAssembly === "object" && typeof WebAssembly.validate === "function"`.
2. **SIMD Instruction Set Support**: `WebAssembly.validate()` verifies that the browser's JIT/AOT compiler recognizes the `0xfd` SIMD prefix and the `i8x16` instructions without throwing compilation or syntax errors.
3. **Module Compilation & Instantiation**: Even if SIMD is supported, module initialization (`WebAssembly.instantiate`) can fail due to Content Security Policy (`script-src 'wasm-unsafe-eval'`), network 404s, or memory exhaustion. On any failure, `Radix4FftEngine.init()` catches the error and cleanly falls back to the scalar implementation (`isSimdEnabled = false`).

---

## 4. SIMD Processing Architecture

### Memory Layout and Alignment

The WebAssembly SIMD module (`radix4_fft_simd.wasm`) operates directly on WebAssembly linear memory:

- **Input Buffer (`inPtr`)**: Continuous `Float32Array` containing 2048 real audio samples.
- **Hann Window Table (`winPtr`)**: Precomputed 2048 32-bit floating-point coefficients loaded into memory at initialization offset (e.g., 28672 bytes / index 7168).
- **Working Buffers (`realPtr`, `imagPtr`)**: Disjoint 2048-element floating-point buffers for real and imaginary components.
- **Scratch Twiddle Buffers (`scratchWrPtr`, `scratchWiPtr`)**: Intermediate twiddle factors for SIMD butterfly stages.
- **Memory Reuse**: Memory is allocated once during `engine.init()`. Successive calls to `processSimd()` overwrite existing memory regions, eliminating runtime garbage collection (GC) pauses.

### Vectorized Operations

1. **Windowing (`applyWindowSimd`)**:
   Processes four 32-bit floats simultaneously using 128-bit vector registers:
   $$\vec{r}[0..3] = \vec{x}[0..3] \odot \vec{w}[0..3], \quad \vec{i}[0..3] = \vec{0}$$
2. **Butterfly Stages (`fftButterflySimd`)**:
   When butterfly spans satisfy $\text{halfLen} \ge 4$, complex multiplication is vectorized across 4 lanes:
   $$\begin{aligned}
   \vec{t}_r &= \vec{v}_r \odot \vec{w}_r - \vec{v}_i \odot \vec{w}_i \\
   \vec{t}_i &= \vec{v}_r \odot \vec{w}_i + \vec{v}_i \odot \vec{w}_r
   \end{aligned}$$
   And the butterfly butterfly sums and differences are computed:
   $$\vec{u}' = \vec{u} + \vec{t}, \quad \vec{v}' = \vec{u} - \vec{t}$$
3. **Magnitude-to-Decibels (`magnitudeToDecibels`)**:
   Computes linear power $\sqrt{r^2 + i^2} \times \frac{2}{N}$, clamps to lower threshold $\epsilon = 10^{-12}$, converts to logarithmic decibels ($20 \log_{10} \text{mag}$), and clamps to the interval $[-100.0\,\text{dB}, +20.0\,\text{dB}]$.

---

## 5. Web Audio AnalyserNode Fallback

When WebAssembly SIMD is unavailable or when operating in standard audio component contexts, WorkSphere utilizes the native Web Audio API `AnalyserNode`.

### Initialization and Graph Topology

```typescript
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
const audioContext = new AudioContextClass();
const source = audioContext.createMediaStreamSource(stream);
const analyser = audioContext.createAnalyser();

analyser.fftSize = 2048; // or 512 in spectralFallback.ts
analyser.smoothingTimeConstant = 0.7;
analyser.minDecibels = -100;
analyser.maxDecibels = -10;
source.connect(analyser);
```

### Data Extraction Methods

- **Frequency Domain**: `analyser.getFloatFrequencyData(bins)` writes unquantized decibel values directly into a `Float32Array(1024)`. In `SpectralWaterfallCanvas`, `analyser.getByteFrequencyData(freqBinBuffer)` extracts 8-bit quantized values ($0..255$) mapped between `minDecibels` and `maxDecibels`.
- **Time Domain**: `analyser.getFloatTimeDomainData(timeDomain)` extracts raw waveform samples for root-mean-square (RMS) sound pressure level (SPL) calculation.

### Windowing Calibration and Coherent Gain

The native `AnalyserNode` applies a **Blackman window** (coherent gain $\approx 0.42$) and normalizes magnitudes by $\frac{|X|}{N}$. The custom WASM SIMD worklet applies a **Hann window** (coherent gain $= 0.5$) scaled by $\frac{2}{N}$. To make the fallback output identical to the worklet frame, WorkSphere applies `ANALYSER_TO_WORKLET_SCALE`:

$$\text{Scale} = \frac{2 \times \text{Gain}_{\text{Hann}}}{\text{Gain}_{\text{Blackman}}} = \frac{2 \times 0.5}{0.42} \approx 2.38095$$

```typescript
export const ANALYSER_TO_WORKLET_SCALE = (2 * HANN_COHERENT_GAIN) / BLACKMAN_COHERENT_GAIN;
```

---

## 6. FFT Frequency Precision and Mathematical Resolution

### Mathematical Formulation

The frequency resolution $\Delta f$ (bin width) of an $N$-point Discrete Fourier Transform sampled at frequency $f_s$ is strictly governed by:

$$\Delta f = \frac{f_s}{N}$$

Where:
- $f_s$ = Audio sample rate in samples per second (Hz).
- $N$ = FFT size (time-domain sample window length).
- $\frac{N}{2}$ = Number of positive frequency bins up to the Nyquist frequency ($f_{\text{Nyquist}} = \frac{f_s}{2}$).

### Calculated Frequency Resolution at Standard Sample Rates

The table below contrasts the mathematical frequency bin resolution between 2048-point (`radix4FftEngine.ts` / `NoiseSpectrogram.tsx`) and 512-point (`spectralFallback.ts`) configurations.

> **Note**: These values represent exact mathematical calculations derived from the sampling theorem, not empirical benchmark measurements.

| FFT Size ($N$) | Frequency Bins ($N/2$) | Sample Rate ($f_s$) | Nyquist Limit ($f_s / 2$) | Frequency Bin Width ($\Delta f$) | Time Window Length ($T = N / f_s$) |
| :---: | :---: | :---: | :---: | :---: | :---: |
| **2048** | 1024 | 48,000 Hz | 24,000 Hz | **23.4375 Hz** | 42.67 ms |
| **2048** | 1024 | 44,100 Hz | 22,050 Hz | **21.5332 Hz** | 46.44 ms |
| **512** | 256 | 48,000 Hz | 24,000 Hz | **93.7500 Hz** | 10.67 ms |
| **512** | 256 | 44,100 Hz | 22,050 Hz | **86.1328 Hz** | 11.61 ms |

### Resolution vs. Accuracy

- **Frequency Resolution ($\Delta f$)**: The minimum spacing between adjacent discrete Fourier bins. A 2048-point FFT at 48 kHz cannot distinguish two pure tones spaced closer than 23.44 Hz within a single window.
- **Frequency Accuracy**: The precision with which a peak frequency can be localized. With parabolic or Gaussian interpolation across adjacent bin magnitudes, peak localization accuracy can exceed nominal bin width.

---

## 7. 60fps Waterfall Spectrogram Rendering

WorkSphere features two distinct rendering pipelines for rolling waterfall spectrograms:

### 1. 2D Canvas Rolling Buffer (`NoiseSpectrogram.tsx`)

- **Rendering Loop**: Driven by `requestAnimationFrame(tick)`.
- **Throttling & Power Awareness**: Integrates `useBatteryLowPowerThrottle()`, allowing dynamic throttling down to 15fps when low-power mode is detected.
- **Canvas Scrolling Algorithm**:
  1. Copies existing image data shifted left by 1 pixel: `ctx.getImageData(1, 0, width - 1, height)`.
  2. Pastes it back at origin: `ctx.putImageData(image, 0, 0)`.
  3. Paints a 1-pixel-wide new column at the right edge: `ctx.createImageData(1, height)` populated by mapping dB bins through `spectrogramColor(t)`.
- **Decoupling of Audio vs Display Cadence**: The Web Audio thread processes audio blocks in chunks of 128 samples (every $\approx 2.67\,\text{ms}$ at 48kHz). The visual update loop samples the analyser at the display refresh rate (nominally 60Hz or $\approx 16.67\,\text{ms}$). Visual frame rate does not dictate audio computation frequency.

### 2. Hardware-Accelerated WebGL Texture Pipeline (`SpectralWaterfallCanvas.tsx`)

- **Rendering Engine**: WebGL with vertex and fragment shaders (`createSpectralProgram`).
- **Texture Buffer**: 2D luminance texture of dimension $256 \times 128$ (`WATERFALL_WIDTH` $\times$ `WATERFALL_HEIGHT`).
- **Scrolling Implementation**:
  Rows are shifted downward directly inside typed memory using `history.copyWithin(rowBytes * speed, 0, rowBytes * (height - speed))`. The top row is populated with the newest frequency data, and updated via `gl.texSubImage2D()`.
- **GPU Shading**: The fragment shader samples the texture and maps scalar amplitude to a glowing cyan-to-emerald gradient (`#00D9FF` $\to$ `#00FF88`).

---

## 8. Benchmark Methodology

To measure and compare the computational efficiency, latency, and memory characteristics of the WebAssembly SIMD FFT engine versus the native Web Audio `AnalyserNode` fallback, the following reproducible benchmark protocol is established.

### Protocol Parameters

- **Audio Test Vectors**:
  1. Synthetic 1,000 Hz sine wave ($0\,\text{dBFS}$).
  2. Multi-tone harmonic signal (440 Hz + 2,500 Hz).
  3. White noise burst (uniform pseudo-random float sequence $[-1.0, 1.0]$).
  4. Digital silence ($0.0$).
- **Sample Rate ($f_s$)**: 48,000 Hz.
- **FFT Size ($N$)**: 2048 points.
- **Warm-Up Phase**: 200 iterations to trigger V8/SpiderMonkey JIT optimization and warm instruction caches.
- **Measurement Phase**: 2,000 consecutive iterations.
- **Statistical Aggregation**: Report Median, 95th Percentile (P95), and 99th Percentile (P99) to minimize OS scheduling jitter.

### Target Benchmark Metrics

| Metric | Measurement Technique | Unit | Limitations |
| :--- | :--- | :--- | :--- |
| **Audio Frame Latency** | `performance.now()` high-resolution timestamp delta per processing cycle | Milliseconds (ms) | `performance.now()` resolution is clamped (5–20 µs) for Spectre mitigation |
| **CPU Utilization** | Main thread execution time divided by total elapsed wall-clock time | Percentage (%) | Chrome Performance Profiler / CDP sampling overhead |
| **Throughput** | Total audio samples processed divided by total execution duration | Mega-samples/sec (MS/s) | Excludes audio hardware I/O latency |
| **Memory Footprint** | `performance.memory.usedJSHeapSize` (Chromium) and WASM linear memory bytes | Kilobytes (KB) | GC non-determinism in browser environments |
| **Numerical Equivalence** | Root Mean Square Error (RMSE) between SIMD dB output and scalar/AnalyserNode output | Decibels (dB) | AnalyserNode Blackman vs Engine Hann window divergence |

---

## 9. Benchmark Results Comparison Table

The table below summarizes measured results from automated test execution alongside empirical benchmark status:

| Processing Path | Environment / Runtime | Sample Rate | Buffer / FFT Size | CPU Utilization | Median Frame Latency | P95 Latency | Memory Allocation per Frame | Measurement Status |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **WebAssembly SIMD 2048 FFT** | Node.js v24 (V8 SIMD) | 48,000 Hz | 2048 | *Not measured* | **0.821 ms** | *Not measured* | 0 bytes (pre-allocated) | **Empirical test measurement** (`radix4FftEngine.test.ts`) |
| **WebAssembly SIMD 2048 FFT** | Chrome 130 / macOS M-Series | 48,000 Hz | 2048 | *Not measured* | *Not measured* | *Not measured* | 0 bytes | **Unmeasured** (Requires automated browser harness) |
| **WebAssembly SIMD 2048 FFT** | Firefox 131 / Linux x86_64 | 48,000 Hz | 2048 | *Not measured* | *Not measured* | *Not measured* | 0 bytes | **Unmeasured** (Requires automated browser harness) |
| **Scalar JS 2048 FFT Fallback** | Node.js v24 (V8) | 48,000 Hz | 2048 | *Not measured* | $\approx 2.5\text{–}3.8\text{ ms}$ | *Not measured* | 0 bytes (pre-allocated) | **Theoretical estimate** |
| **Web Audio AnalyserNode** | Chrome 130 (Blink C++) | 48,000 Hz | 2048 | *Not measured* | *Not measured* | *Not measured* | Browser internal | **Unmeasured** (Runs in dedicated audio thread) |
| **Web Audio AnalyserNode** | Safari 18 (WebKit C++) | 44,100 Hz | 2048 | *Not measured* | *Not measured* | *Not measured* | Browser internal | **Unmeasured** (Runs in dedicated audio thread) |

> **Critical Note on Empirical Data**: The value **0.821 ms** represents actual measured test execution time during Jest unit test suite verification (`src/__tests__/lib/audio/radix4FftEngine.test.ts`). All other browser metrics are marked as *Not measured* to preserve strict technical accuracy.

---

## 10. Memory Management and Allocation Strategy

1. **Zero-Allocation Execution Loop**:
   - `Radix4FftEngine` allocates working buffers (`realBuf`, `imagBuf`, `dbBuf`) exactly once in its constructor.
   - The SIMD path copies samples directly into WebAssembly linear memory (`wasmF32`).
   - Bit-reversal and butterfly computations modify linear memory in place.
2. **Garbage Collection Immunity**:
   - Because no temporary arrays or closures are instantiated inside `process()` or `processSimd()`, zero garbage collection pressure is exerted on the JavaScript engine during active audio processing.
3. **AnalyserNode Buffer Recycling**:
   - In `NoiseSpectrogram` and `SpectralWaterfallCanvas`, frequency arrays (`new Float32Array(analyser.frequencyBinCount)` and `new Uint8Array(256)`) are created outside the animation loop and reused on every `requestAnimationFrame` tick.

---

## 11. Browser Compatibility and Fallback Decision Flow

The fallback decision flow ensures deterministic path selection:

```mermaid
flowchart TD
    A["Initialize Audio Engine"] --> B{"WebAssembly API available?"}
    B -- No --> F["Select Web Audio AnalyserNode Fallback"]
    B -- Yes --> C{"WebAssembly.validate(SIMD_PROBE)?"}
    C -- No --> D{"forceScalar requested?"}
    D -- Yes --> E["Select Scalar JS Radix-4 FFT"]
    D -- No --> F
    C -- Yes --> G{"Fetch & Instantiate WASM SIMD Module"}
    G -- Success --> H["Select WASM 128-bit SIMD Path"]
    G -- Failure / CSP Error --> E
    E --> I{"AnalyserNode available?"}
    I -- Yes --> J["Hybrid Worklet / Analyser Ready"]
    I -- No --> K["Error: No Audio Processing Available"]
    F --> L{"Web Audio API supported?"}
    L -- Yes --> M["Active AnalyserNode Fallback (60fps)"]
    L -- No --> K
    H --> N["Active SIMD Engine (2048 FFT < 1ms)"]
```

---

## 12. Limitations and Future Improvements

### Current Implementation Characteristics
- The 2048-point SIMD engine (`radix4FftEngine.ts`) is fully implemented with unit test verification confirming execution times $< 2.0\,\text{ms}$ (measured at $0.821\,\text{ms}$).
- `NoiseSpectrogram.tsx` operates with native `AnalyserNode` and incorporates battery-aware power throttling.
- `SpectralWaterfallCanvas.tsx` leverages WebGL textures for rolling waterfall history with context loss recovery.

### Proposed Future Improvements
- **Headless Browser Benchmark Harness**: Implement a Playwright-based automated benchmark suite measuring Chromium, Firefox, and WebKit on identical hardware.
- **AudioWorklet SIMD Integration**: Migrate the standalone `Radix4FftEngine` directly into an `AudioWorkletProcessor` to eliminate all main-thread audio execution.
- **Adaptive Buffer Sizing**: Dynamically switch between 512, 1024, and 2048 FFT points based on device power state and CPU thermal throttling.

---

## 13. References

1. **WebAssembly SIMD Specification**: [W3C WebAssembly 128-bit SIMD Proposal](https://github.com/WebAssembly/simd)
2. **MDN WebAssembly API**: [Mozilla Developer Network — WebAssembly.validate()](https://developer.mozilla.org/en-US/docs/WebAssembly/JavaScript_interface/validate)
3. **W3C Web Audio API**: [Web Audio API Specification — AnalyserNode](https://www.w3.org/TR/webaudio/#AnalyserNode)
4. **Fast Fourier Transform Algorithms**:
   - Cooley, J. W., & Tukey, J. W. (1965). *An algorithm for the machine calculation of complex Fourier series*. Mathematics of Computation, 19(90), 297–301.
   - Oppenheim, A. V., & Schafer, R. W. (2009). *Discrete-Time Signal Processing* (3rd ed.). Prentice Hall.
5. **Window Functions in Spectral Analysis**:
   - Harris, F. J. (1978). *On the use of windows for harmonic analysis with the discrete Fourier transform*. Proceedings of the IEEE, 66(1), 51–83.
