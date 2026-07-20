# Web Audio API Noise Meter Architecture

This document provides a comprehensive implementation guide for the client-side noise meter, detailing browser microphone permissions, the Web Audio API lifecycle, frequency bin calculations, real-time decibel (dB) measurements, and the WebAssembly (WASM) acceleration layer.

---

## 1. High-Level Architecture Overview

The noise meter functions by capturing hardware microphone input, feeding it through a real-time signal processing graph, and extracting amplitude values to map human-perceivable environmental loudness levels. The RMS computation is offloaded to a WebAssembly module for performance, with proper heap memory management to prevent leaks.

The data pipeline flows linearly through the following stages:

[ Hardware Microphone ]
│
▼
[ MediaStream (Navigator API) ]
│
▼
[ MediaStreamAudioSourceNode ]
│
▼
[ AnalyserNode (Fast Fourier Transform) ]
│
▼
[ WASM RMS Processor ] ──→ [ JavaScript dB Conversion ] ──→ [ UI Render Component ]
│                             │
└── malloc/free/resetHeap ────┘     (memory lifecycle per frame)

---

## 2. Browser Permission Handling & Lifecycle

Accessing hardware devices requires user explicit consent via the browser's Permissions API wrapper. Because browsers strictly restrict unauthorized sound capture, the processing lifecycle cannot begin until permissions are resolved.

### Safety & Constraints:

- Autoplay Policies: Modern browsers suspend the audio pipeline automatically unless the creation sequence originates directly from a user gesture (e.g., clicking a "Start Meter" button).
- Secure Contexts: The `getUserMedia` hook is blocked on insecure environments. It requires HTTPS on public domains, or localhost for local testing.

---

## 3. Audio Context & Processing Graph

The framework relies on an isolated environment called the `AudioContext`. Inside this context, custom audio modular nodes are explicitly routed together.

### Core Processing Nodes:

1. MediaStreamAudioSourceNode: Acts as the entry interface that swallows the raw incoming browser hardware track.
2. AnalyserNode: A non-destructive pass-through node that performs real-time Fast Fourier Transform (FFT) analysis to generate frequency and time-domain records without modifying the output stream.

---

## 4. WebAssembly Memory Management (Memory Leak Fix)

The core fix for the WASM memory growth issue is implemented in `src/lib/wasm/noiseProcessor.ts`. The WASM module (`public/noise-processor.wasm`) provides a bump allocator with explicit `malloc`/`free` functions.

### Key Memory Management Strategy:

1. **Fixed Pointer Reuse**: A single cached WASM memory pointer (`cachedBufferPtr`) is allocated on the first frame and reused for all subsequent frames. New allocations happen only when a larger buffer is needed.

2. **Explicit Free on Cleanup**: When measurement completes or the component unmounts, `resetNoiseProcessor()` calls `wasm.free()` on the cached pointer and resets the heap via `resetHeap()`.

3. **Module Lifecycle**: The WASM module is loaded lazily on first use and cached via `instancePromise`. `resetNoiseProcessor()` clears this cache to allow full garbage collection.

### WASM Module Exports:

| Export       | Signature                  | Purpose                           |
|-------------|----------------------------|-----------------------------------|
| `malloc`     | `(size: i32) -> i32`       | Allocate `size` bytes, return ptr |
| `free`       | `(ptr: i32, size: i32)`    | Free allocation at ptr            |
| `computeRMS` | `(ptr: i32, len: i32) -> f32` | Compute RMS of float32 array   |
| `resetHeap`  | `() -> void`               | Reset bump allocator to initial   |

### Without this fix:
```
Frame 1: malloc(8192) → ptr=1024  ✓
Frame 2: malloc(8192) → ptr=9216  ✗ (new allocation, old not freed)
...
Frame N: heap exhausted → browser crash
```

### With this fix:
```
Frame 1: malloc(8192) → ptr=1024 (cached)
Frame 2: reuse ptr=1024           ✓ (same pointer)
...
Frame N: free(ptr, 8192)          ✓ (on cleanup)
```

---

## 5. Signal Analysis & Decibel Calculation

The real-time calculation translates raw computational arrays into human-readable decibel sound scales.

### FFT Buffer Sizing

The `AnalyserNode.fftSize` property defines the window size used for frequency analysis. It must be a power of two (e.g., 2048). The number of data bins available for evaluation is always exactly half of the total FFT window size (known as the Nyquist frequency boundary).

### The Math: Root Mean Square (RMS) to Decibels

To measure the overall intensity over a discrete time window, we calculate the Root Mean Square (RMS) of the raw time-domain pulse samples, then map it logarithmically to a decibel scale:

1. RMS Calculation (offloaded to WASM):
   Square each absolute amplitude sample in the array, find the mathematical average of those squared values, and compute the square root of that average.

2. Logarithmic Decibel Conversion (JavaScript):
   Convert the derived average pressure scale into decibel levels using the standard formula:
   dB = 20 * log10(RMS)

Because raw digital audio amplitudes top out at a float ceiling value of 1.0, the computed raw dB values represent a negative range stretching downwards from 0 dBFS (Decibels relative to Full Scale) towards negative infinity. A soft noise floor multiplier is added inline within the rendering system to normalize these metrics for standard UI layouts.

---

## 6. Source Files Reference

| File | Purpose |
|------|---------|
| `src/components/noise/NoiseMeter.tsx` | React component, UI + measurement orchestration |
| `src/lib/wasm/noiseProcessor.ts` | WASM loader with memory management |
| `public/noise-processor.wasm` | Compiled WASM module |
| `wasm/noise-processor.wat` | WebAssembly Text Format source |
| `wasm/compile.js` | WAT → WASM compilation script |
| `wasm/verify.js` | WASM module functional verification |
