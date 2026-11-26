# Acoustic Filter Engine & Web Audio SIMD Fallback Guide

This guide details the architecture, configuration, fallback flow, and troubleshooting procedures for WorkSphere's client-side acoustic noise filtering engine (`AcousticFilterEngine`). It covers the dual-engine pipeline bridging high-performance WebAssembly 128-bit SIMD vector processing and native Web Audio API (`AnalyserNode` / `BiquadFilterNode`) fallback graphs.

---

## 1. Overview & Architectural Motivation

In remote collaborative spaces and digital nomad venues, background ambient noise (e.g., espresso machines, chatter, air conditioning hum) degrades voice call quality and compromises acoustic privacy. WorkSphere provides real-time client-side acoustic suppression and telemetry directly within the browser runtime.

### Dual-Engine Processing Strategy

```
                                [ Microphone AudioStream ]
                                            │
                                            ▼
                              [ AudioContext (48kHz/44.1kHz) ]
                                            │
                                ┌───────────┴───────────┐
                                ▼                       ▼
                   [ SIMD Capability Probe ]  [ Native Web Audio Graph ]
                     WebAssembly.validate()      BiquadFilter / Analyser
                                │                       │
                   ┌────────────┴────────────┐          │
                   ▼                         ▼          │
          [ WASM 128-bit SIMD ]     [ WASM Scalar Fallback ]
          (Vectorized FFT / DSP)     (Sequential Radix-4)
                   │                         │          │
                   └────────────┬────────────┘          │
                                ▼                       ▼
                        [ Spectral Bins ]      [ Filtered Audio Out ]
                                │                       │
                                ▼                       ▼
                        [ Visualizer/HUD ]     [ WebRTC Peer Mesh ]
```

1. **High-Performance Vector Pipeline (WASM SIMD)**:
   - Leverages `wasm_simd128` instructions executing four parallel 32-bit floating point calculations per cycle.
   - Processes Fast Fourier Transform (FFT) butterfly operations, windowing, and spectral subtraction with sub-millisecond overhead.
2. **Standard Web Audio Graph (`BiquadFilterNode` & `AnalyserNode`)**:
   - Universal fallback executing within the browser engine's optimized native C++ audio thread.
   - Provides pop-free cascaded notch and bandpass filtering alongside hardware-accelerated frequency analysis without requiring WebAssembly or SharedArrayBuffer support.

---

## 2. Capability Probing: `isSimdSupported()`

To prevent runtime compilation exceptions on older browsers or restricted WebViews, the engine dynamically probes WebAssembly SIMD capabilities at startup using `WebAssembly.validate()` against minimal valid SIMD bytecode:

```typescript
/**
 * Minimal WebAssembly binary exercising wasm_simd128 instructions:
 * (module
 *   (func (result v128)
 *     v128.const i32x4 0 0 0 0
 *   )
 * )
 */
const SIMD_TEST_BYTES = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60, 0x00,
  0x01, 0x7b, 0x03, 0x02, 0x01, 0x00, 0x0a, 0x16, 0x01, 0x14, 0x00, 0xfd, 0x0c,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x0b,
]);

export function isSimdSupported(): boolean {
  try {
    return (
      typeof WebAssembly === "object" &&
      typeof WebAssembly.validate === "function" &&
      WebAssembly.validate(SIMD_TEST_BYTES)
    );
  } catch {
    return false;
  }
}
```

### Fallback Priority Matrix

|    Tier    | Engine Target            | Condition                       | Features                                                       |
| :--------: | :----------------------- | :------------------------------ | :------------------------------------------------------------- |
| **Tier 1** | **WASM SIMD 128-bit**    | Browser supports `wasm_simd128` | Vectorized 2048-point Radix-4 FFT, real-time noise estimation. |
| **Tier 2** | **WASM Scalar DSP**      | WASM enabled, no SIMD           | Standard scalar floating-point buffer transformations.         |
| **Tier 3** | **Native Web Audio API** | No WASM / AudioWorklet blocked  | Cascaded `BiquadFilterNode` chain and native `AnalyserNode`.   |

---

## 3. Acoustic Filter Node Graph & Presets

`AcousticFilterEngine` (`src/lib/audio/acousticFilterEngine.ts`) implements typed audio presets configured via equal-power crossfading to eliminate pops, clicks, or phase artifacts during transitions:

```
                      ┌───> [bypassGain] ────────────────────────┐
                      │                                          │
[inputNode] ──────────┼───> [voiceFocusNode] ───> [voiceGain] ───┼───> [processedGain] ───> [outputNode]
                      │                                          │
                      └───> [cafeNotch120] ──> [cafeNotch240] ───┘
                                       └──> [cafeGain] ──────────┘
```

### Supported Presets

- **`'off'`**: Unmodified audio signal bypass (`bypassGain = 1.0`, `processedGain = 0.0`).
- **`'voice-focus'`**: Bandpass filter isolating the human speech telephony band (300 Hz – 3400 Hz) using a 2nd-order Biquad bandpass filter centered at ~1850 Hz with $Q = 1.0$. Attenuates low rumblings and high-frequency hiss.
- **`'cafe-suppress'`**: Cascaded dual-notch filters targeting 120 Hz and 240 Hz harmonics ($Q = 4.0$). Eliminates low-frequency motor hum, air conditioning compressors, and refrigeration noise while retaining full voice fidelity.

### Pop-Free Automation & Gain Clamping

All filter parameter updates (frequency, $Q$, gain) are clamped to Nyquist boundaries ($f_{max} = \frac{\text{sampleRate}}{2} - 1$) and smoothly ramped via `setTargetAtTime`:

$$\text{gain}(t) = \text{target} + (\text{current} - \text{target}) \cdot e^{-\frac{t - t_0}{\tau}}$$

where $\tau$ (`transitionTimeConstant`) defaults to $50\text{ ms}$.

---

## 4. Developer Configuration & Usage Examples

### Initializing the Filter Engine with User Microphone

```typescript
import {
  AcousticFilterEngine,
  clampFrequency,
} from "@/lib/audio/acousticFilterEngine";

async function initializeAudioCall() {
  // 1. Create AudioContext
  const audioContext = new (
    window.AudioContext || (window as any).webkitAudioContext
  )({
    sampleRate: 48000,
    latencyHint: "interactive",
  });

  // 2. Request user media with acoustic echo cancellation
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: false, // Managed by WorkSphere engine
      autoGainControl: true,
    },
  });

  // 3. Instantiate acoustic filter engine
  const filterEngine = new AcousticFilterEngine(audioContext, {
    initialPreset: "voice-focus",
    transitionTimeConstant: 0.04, // 40ms crossfade
  });

  // 4. Connect media source through filter engine
  const sourceNode = audioContext.createMediaStreamSource(stream);
  sourceNode.connect(filterEngine.inputNode);

  // 5. Connect output to WebRTC destination or audio graph
  const destination = audioContext.createMediaStreamDestination();
  filterEngine.outputNode.connect(destination);

  return { filterEngine, processedStream: destination.stream };
}
```

### Dynamic Preset Switching

```typescript
// Seamlessly switch to cafe noise suppression when background noise increases
filterEngine.setPreset("cafe-suppress");

// Check active preset
console.log("Current preset:", filterEngine.getPreset()); // "cafe-suppress"

// Clean up resources on call teardown
filterEngine.dispose();
```

---

## 5. Cross-Browser Troubleshooting & Audio Policies

### 1. AudioContext Autoplay Restrictions

Modern browsers prevent `AudioContext` instances from running until an explicit user gesture (click, tap, keypress) has occurred.

- **Symptom**: `audioContext.state === "suspended"`; no audio passes through the graph.
- **Remedy**: Resume context inside a user event handler or register visibility change recovery:

```typescript
async function ensureAudioContextRunning(ctx: AudioContext): Promise<void> {
  if (ctx.state === "suspended") {
    await ctx.resume();
  }
}

// Automatically resume when returning to active tab
document.addEventListener("visibilitychange", () => {
  if (
    document.visibilityState === "visible" &&
    audioContext.state === "suspended"
  ) {
    audioContext.resume().catch(() => {
      // User gesture might still be required
    });
  }
});
```

### 2. Microphone Permissions & Device Errors

| Error Name         | Cause                                                     | Resolution                                                                           |
| :----------------- | :-------------------------------------------------------- | :----------------------------------------------------------------------------------- |
| `NotAllowedError`  | User dismissed or denied microphone access prompt.        | Guide user to click the camera/mic icon in the browser URL bar to grant permissions. |
| `NotFoundError`    | No audio input device detected on client machine.         | Display fallback indicator prompting user to connect a microphone or headset.        |
| `NotReadableError` | Hardware mic locked by another process or OS application. | Prompt user to close competing conferencing apps (Zoom, Teams).                      |

### 3. WebAssembly SIMD Browser Compatibility Matrix

| Browser                      | Minimum Version for SIMD (`wasm_simd128`) | Fallback Path                   |
| :--------------------------- | :---------------------------------------: | :------------------------------ |
| **Google Chrome / Chromium** |                    91+                    | Native Web Audio `AnalyserNode` |
| **Mozilla Firefox**          |                    89+                    | Native Web Audio `AnalyserNode` |
| **Apple Safari**             |             16.4+ (iOS 16.4+)             | Native Web Audio `AnalyserNode` |
| **Microsoft Edge**           |                    91+                    | Native Web Audio `AnalyserNode` |

---

## 6. Verification & Quality Checklist

- [x] Capability check probes `WebAssembly.validate` safely.
- [x] Frequencies and Q-factors clamped within Nyquist and stability thresholds.
- [x] Transitions crossfaded without clicking or audible pop artifacts.
- [x] AudioContext lifecycle handled across background tabs and screen lock events.
