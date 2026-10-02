# WASM SIMD Multi-Channel Audio Filter Pipeline

WorkSphere ships a WebAssembly module that runs a cascade of biquad filters over **multi-channel** audio buffers. It uses 128-bit WASM SIMD where the browser supports it and falls back to a scalar build where it doesn't. Spatial audio features use it for EQ, band-limiting and tone shaping. It handles a full 8-channel Web Audio render block in a few microseconds, far below the 5 ms latency budget.

| Piece                                            | Role                                                       |
| ------------------------------------------------ | ---------------------------------------------------------- |
| `wasm/audio-filter/audio_filter.c`               | C11 DSP core (biquad cascade + output gain), freestanding  |
| `wasm/audio-filter/build.sh`                     | Builds the SIMD and scalar binaries with clang             |
| `public/audio-filter-simd.wasm`                  | `-msimd128` build (~5 KB)                                  |
| `public/audio-filter-scalar.wasm`                | Scalar fallback build (~2 KB)                              |
| `src/lib/wasm/audioFilterPipeline.ts`            | Coefficient design, SIMD detection, loader, typed wrapper  |
| `src/__tests__/lib/wasm/audioFilterPipeline.test.ts` | Tests the real binaries against a JS reference         |

> This module is independent of the FFT noise-suppression engine in `wasm/audio-dsp/` (see `WASM_SIMD_AUDIO_DSP_MANUAL.md`). That engine is a mono spectral gate. This one is a general multi-channel time-domain filter chain.

## 1. Usage

```typescript
import { loadAudioFilterPipeline } from "@/lib/wasm/audioFilterPipeline";

// Picks audio-filter-simd.wasm or audio-filter-scalar.wasm automatically
const pipeline = await loadAudioFilterPipeline();

pipeline.setStages(
  [
    { type: "highpass", frequency: 80 },                      // rumble removal
    { type: "peaking", frequency: 3000, q: 1.2, gainDb: 3 },  // speech presence
    { type: "lowpass", frequency: 12000 },
  ],
  48000,
);
pipeline.setOutputGain(0.9);

// Planar channels (e.g. AudioBuffer.getChannelData(c)), filtered IN PLACE.
const elapsedMs = pipeline.process([left, right, centre, lfe, surroundL, surroundR]);
```

Filter state carries over between `process()` calls, so you can stream audio in render-quantum-sized blocks (128 frames) without clicks at block boundaries. Call `reset()` after a seek or a stream restart.

### Supported filters

Coefficients follow the RBJ *Audio EQ Cookbook* and are normalised so that `a0 = 1`.

| `type`      | Parameters used          | Notes                         |
| ----------- | ------------------------ | ----------------------------- |
| `lowpass`   | `frequency`, `q`         | `q` defaults to 1/√2 (Butterworth) |
| `highpass`  | `frequency`, `q`         |                               |
| `bandpass`  | `frequency`, `q`         | 0 dB peak gain                |
| `notch`     | `frequency`, `q`         | e.g. 50/60 Hz hum             |
| `peaking`   | `frequency`, `q`, `gainDb` |                             |
| `lowshelf`  | `frequency`, `q`, `gainDb` |                             |
| `highshelf` | `frequency`, `q`, `gainDb` |                             |

`designBiquad()` throws a `RangeError` when `frequency` is not in `(0, sampleRate / 2)`, when `q <= 0`, or when any value is non-finite. Bad input fails loudly instead of producing an unstable filter.

### Limits

| Limit         | Value | Reason                                               |
| ------------- | ----- | ---------------------------------------------------- |
| Channels      | 8     | Covers 7.1. Two SIMD groups of 4                     |
| Stages        | 8     | Per-stage state lives in fixed static arrays         |
| Frames / call | 4096  | Longer buffers are chunked by the wrapper; state stays continuous |

## 2. How the SIMD path works

A biquad is **recursive**: each output sample depends on the previous outputs. You can't vectorise across samples of one channel. Instead the module vectorises **across channels**: one `v128` holds the same frame from 4 different channels.

Audio arrives *planar* (each channel contiguous), so the module transposes 4×4 blocks:

```
 rows (planar, contiguous loads)        frames (one vector per time step)
 ch0: [a0 a1 a2 a3]                     t0: [a0 b0 c0 d0]
 ch1: [b0 b1 b2 b3]   ─ transpose4 ─▶   t1: [a1 b1 c1 d1]
 ch2: [c0 c1 c2 c3]                     t2: [a2 b2 c2 d2]
 ch3: [d0 d1 d2 d3]                     t3: [a3 b3 c3 d3]
```

1. Four aligned `v128.load`s read 4 frames from 4 channels.
2. `transpose4` (8 × `i32x4.shuffle`) turns rows into frame vectors.
3. Each frame vector runs through every stage in Transposed Direct Form II, using `f32x4` mul/add/sub with per-lane delay state.
4. A second `transpose4` turns the results back into rows, followed by four aligned stores.

Frame counts that aren't a multiple of 4 finish with a short gather/scatter tail loop. Channel counts that aren't a multiple of 4 point the unused lanes at a zeroed scratch row. The output gain stage is a plain contiguous `f32x4.mul` per channel.

Delay state is flushed to zero once it falls below `1e-15` after each block. This stops a decaying filter from slowing down on denormal floats, since WASM has no flush-to-zero mode.

## 3. Runtime selection and fallback

A module that contains SIMD instructions fails to **compile** on engines without WASM SIMD, so a runtime flag can't rescue it. Two binaries are shipped instead:

- `isWasmSimdSupported()` calls `WebAssembly.validate()` on a tiny module that contains one `v128.const`.
- `loadAudioFilterPipeline()` fetches the SIMD build when that check passes, and the scalar build otherwise. Pass `{ forceScalar: true }` to override.
- The SIMD build also exports `setSIMDEnabled(0)` (exposed as `pipeline.setSimdEnabled(false)`). It switches to the scalar loops in the same binary, for devices where SIMD validates but misbehaves (see #1140).

Both paths give the same output to within float rounding; the tests check this.

## 4. Building

The module is freestanding C with no libc and no Emscripten runtime. The only tools you need are `clang` (with the wasm32 target) and `wasm-ld`:

```bash
npm run build:wasm:audio-filter
```

The build uses `-O3 -nostdlib -ffreestanding -Wall -Wextra -Werror -Wl,--no-entry -Wl,--strip-all`, adding `-msimd128` for the SIMD variant. Builds are reproducible: the same compiler produces byte-identical output. The binaries need **no imports**. Instantiate them with `WebAssembly.instantiate(bytes)`; no import object is required.

Coefficient design needs `sin`/`cos`/`pow`, so it runs in TypeScript. Coefficients are passed in through `setStage()`, which keeps libm out of the binary.

### Exported ABI

| Export                                 | Description                                        |
| -------------------------------------- | -------------------------------------------------- |
| `getBufferPtr()`                       | Byte offset of the planar I/O buffer (16-byte aligned). Channel `c` starts at `ptr + c * maxFrames * 4` |
| `getMaxChannels/Frames/Stages()`       | Compile-time limits                                |
| `isSIMDBuild()`                        | `1` for the `-msimd128` build                      |
| `setStage(i, b0, b1, b2, a1, a2)`      | Set normalised coefficients for stage `i`          |
| `setStageCount(n)`                     | Activate `n` stages and reset state                |
| `setOutputGain(g)`                     | Linear post-filter gain                            |
| `process(channels, frames)`            | Filter in place. Returns `0`, or `-1` on bad dimensions |
| `reset()`                              | Zero all delay lines                               |
| `setSIMDEnabled(0 \| 1)`               | Switch to/from the scalar loops in the SIMD build  |

## 5. Performance

These numbers time the WASM kernel only, with 8 stages, in Node 26 / V8 on x86-64. The `process()` wrapper adds the planar copy into WASM memory.

| Build  | Shape                | Median  | p99     |
| ------ | -------------------- | ------- | ------- |
| SIMD   | 2 ch × 128 frames    | 1.3 µs  | 3.8 µs  |
| SIMD   | 8 ch × 128 frames    | 2.7 µs  | 4.6 µs  |
| SIMD   | 8 ch × 1024 frames   | 20 µs   | 30 µs   |
| Scalar | 8 ch × 128 frames    | 19.6 µs | 37 µs   |
| Scalar | 8 ch × 1024 frames   | 166 µs  | 289 µs  |

A 128-frame render block at 48 kHz lasts 2.67 ms. Even the scalar fallback uses under 1.5 % of that budget. The test suite enforces a median **and** p99 under 5 ms for 8 channels × 128 frames on both builds.

## 6. Testing

```bash
npx jest src/__tests__/lib/wasm/audioFilterPipeline.test.ts
```

The suite instantiates the committed binaries from `public/` and checks:

- The frequency response of every filter type: cutoff −3 dB points, shelf and peak gains, notch depth.
- Bit-level agreement (≤ 1e-5) with a float32 JS reference for 1, 2, 4, 6 and 8 channels. This covers partial SIMD groups and non-multiple-of-4 frame tails.
- State continuity across 128-frame render blocks and across `maxFrames` chunking.
- Channel independence, output gain, pass-through, `reset()`, and input validation.
- SIMD-vs-scalar parity, plus the loader's choice of binary and its fetch error handling.
- The latency budget described in §5.

If you change `audio_filter.c`, run `npm run build:wasm:audio-filter` and commit the regenerated `.wasm` files with your change. The tests run against the binaries, so they catch a stale build.
