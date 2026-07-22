# Audio Equalizer Architecture

## Overview

Realtime multi-user WebAssembly audio equalizer preview. Users can adjust 10
ISO-standard frequency bands (31 Hz – 16 kHz), see the combined frequency
response curve update instantly on a canvas, and hear the result through their
device microphone via an AudioWorkletProcessor.

## Layer stack

```
AudioEqualizer.tsx        ← React component (canvas + band sliders)
useAudioEqualizer.ts      ← React hook (state management)
audioEqualizer.ts         ← WASM loader + peaking coefficient math
audio-equalizer-processor.js ← AudioWorkletProcessor (audio thread)
audio-equalizer.wasm      ← WebAssembly (Biquad IIR cascade)
audio-equalizer.wat       ← Hand-written WAT source
```

## WASM module (`audio-equalizer.wasm`, 994 bytes)

Hand-written WAT implementing a multi-band Biquad IIR filter cascade.

### Exported functions

| Function | Signature | Purpose |
|---|---|---|
| `malloc` | `(size: i32) → i32` | Bump-allocate from WASM heap (starts at 1024) |
| `free` | `(ptr: i32, size: i32)` | Deallocate if top-of-heap |
| `resetHeap` | `() → ()` | Reset bump allocator to 1024 |
| `setBandsPtr` | `(ptr: i32)` | Store base of per-band state array |
| `initBiquadState` | `(bandIndex, b0, b1, b2, a1, a2)` | Initialize 9-float state for one band |
| `processSample` | `(input: f32, numBands: i32) → f32` | Run one sample through all bands |
| `processBlock` | `(inputPtr, outputPtr, length, numBands)` | Process a block of samples |

### Per-band memory layout (36 bytes each)

| Offset | Field | Type |
|---|---|---|
| 0 | x1 (previous input) | f32 |
| 4 | x2 (second-previous input) | f32 |
| 8 | y1 (previous output) | f32 |
| 12 | y2 (second-previous output) | f32 |
| 16 | b0 | f32 |
| 20 | b1 | f32 |
| 24 | b2 | f32 |
| 28 | a1 | f32 |
| 32 | a2 | f32 |

### Biquad transfer function

```
       b0 + b1·z⁻¹ + b2·z⁻²
H(z) = ────────────────────
       1  + a1·z⁻¹ + a2·z⁻²
```

All bands are cascaded (series). Each band feeds into the next.

## Peaking filter coefficients (computed in JS)

```js
A     = 10^(gainDB / 40)
w0    = 2π · fc / sampleRate
alpha = sin(w0) / (2 · Q)

b0 = 1 + alpha · A
b1 = -2 · cos(w0)
b2 = 1 - alpha · A
a0 = 1 + alpha / A
a1 = -2 · cos(w0)
a2 = 1 - alpha / A

// Normalise by a0
b0' = b0/a0,  b1' = b1/a0,  b2' = b2/a0
a1' = a1/a0,  a2' = a2/a0
```

## Frequency response curve

Computed entirely in JS (no WASM needed) using `computeBandResponse()` which
evaluates the biquad magnitude at each frequency:

```js
z = e^(jw)
num = b0 + b1·z⁻¹ + b2·z⁻²
den = 1  + a1·z⁻¹ + a2·z⁻²
mag = 20 · log10(|num/den|)
```

Total response = sum of all bands' magnitudes (in dB) at each frequency point.

## AudioWorkletProcessor

`public/audio-equalizer-processor.js` — registered as
`"audio-equalizer-processor"`. The WASM binary is transferred from the main
thread via `globalThis.__audioEqWasm` (an `ArrayBuffer`). The processor:

1. Compiles and instantiates the WASM on first `process` call
2. Receives band updates via `port.onmessage`
3. Calls `processBlock()` for each 128-frame audio block

## React hook (`useAudioEqualizer`)

Exposes:

- `state.bands` — current band array
- `state.bypass` — bypass toggle
- `state.isReady` — WASM loaded and initialised
- `frequencyResponse` — `{ frequencies, magnitudes }` for canvas
- `setBand(index, gain)` — update gain for one band
- `toggleBypass()` — toggle bypass
- `resetBands()` — reset all bands to 0 dB
- `processAudio(samples)` — run Float32Array through WASM

## Component (`AudioEqualizer.tsx`)

- Canvas with frequency response curve (log-frequency x-axis, dB y-axis)
- 10 gain sliders with ±12 dB range
- Bypass toggle button
- Global and per-band reset buttons

## Default bands (10-band ISO)

31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000 Hz — all with Q=0.707
and 0 dB gain.
