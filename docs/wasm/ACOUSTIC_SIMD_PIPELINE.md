# Acoustic WASM SIMD Pipeline (FFT & RT60)

## 1. Architecture Diagram (WebAudio -> SharedArrayBuffer -> WASM Linear Memory -> UI)

```text
[Microphone / MediaStreamAudioSourceNode]
                |
                v
[AudioWorkletProcessor (128-sample quantum)]
                |  (writes PCM block + Atomics head/tail)
                v
[SharedArrayBuffer Ring Buffer (ephemeral, overwritten in-place)]
                |
                v
[WASM Linear Memory (f32x4 128-bit SIMD FFT + RT60 estimator)]
   |-- SIMD path (wasm32 simd128: f32x4 butterfly ops)
   +-- Scalar fallback (portable IEEE-754 f32 loop)
                |
                v  (emits ONLY dB, band buckets, RT60; zero raw PCM)
[SoundLevelMeter.tsx / Venue Acoustic Telemetry]