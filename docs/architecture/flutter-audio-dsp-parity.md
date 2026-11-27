# WorkSphere Flutter Native AudioWorklet / FFT Parity & Ambient Noise DSP

Documents how WorkSphere's Web Audio `AdaptiveNoiseFilter` (`src/lib/audio/AdaptiveNoiseFilter.ts`), C/WASM FFT kernel (`src/wasm/noise_fft.c`), and `SoundLevelMeter` (`src/components/audio/SoundLevelMeter.tsx`) translate to Flutter native audio capture, platform channels, and `dart:ffi` DSP.

---

## 1. Web Reference Parameters to Preserve

| Component | Parameter | Web Value |
| :--- | :--- | :--- |
| `AdaptiveNoiseFilter` | High-pass cutoff (HVAC rumble) | `150 Hz`, `Q = 0.707` (`highpass`) |
| `AdaptiveNoiseFilter` | Default static notch frequencies | `[60, 120, 2400]` Hz (AC hum + espresso whine) |
| `AdaptiveNoiseFilter` | Dynamic tracking notch initial freq | `2800 Hz` |
| `AdaptiveNoiseFilter` | Notch `Q` presets | `narrow: 12`, `balanced: 8` (default), `wide: 4` |
| `AdaptiveNoiseFilter` | Speech VAD threshold / target attenuation | `-42 dB` / `15 dB` (target `12–18 dB`) |
| `AdaptiveNoiseFilter` | FFT size & smoothing | `fftSize = 1024`, `smoothingTimeConstant = 0.8` |
| `DecibelMeter` / `noise_fft.c` | RMS -> dB mapping | `20 * log10(rms) + 100.0`, clamped `[20, 120]` (`[30, 120]` UI meter) |
| `SoundLevelMeter` | Alert threshold & sustained duration | Default `65 dB` (`40–85 dB` range), sustained `3000 ms` |
| `SoundLevelMeter` | Noise categories | `< 50 dB` Quiet, `50–69 dB` Moderate, `>= 70 dB` Loud |

---

## 2. Flutter Architecture: Platform Channels + `dart:ffi` C/Rust DSP

Browser `AudioWorklet` threads have no direct Dart equivalent; Flutter runs real-time PCM capture on the platform audio thread and executes deterministic DSP in native C/Rust shared between WebAssembly and mobile.

```text
[ Native Mic Capture Thread ]
  Android: AudioRecord (UNPROCESSED)   |   iOS: AVAudioEngine (measurement mode)
                │
                ▼  (PCM float32 frames, e.g. 1024 samples @ 48 kHz)
[ Native DSP Kernel (C via noise_fft.c / RBJ Biquad or Rust biquad + rustfft) ]
  1. Biquad High-Pass (150 Hz, Q=0.707)
  2. Cascaded Notch Chain (60 Hz, 120 Hz, 2400 Hz + dynamic notch, Q=4/8/12)
  3. Radix-2 FFT (N=1024 / 2048) & RMS -> dB SPL
                │
                ├──> Filtered PCM -> WebRTC peer audio track (if call active)
                └──> EventChannel / Isolate SendPort (20–30 Hz throttled telemetry)
                          │
                          ▼
               [ Flutter SoundLevelMeter Widget ]
```

### 2.1 Reusing `src/wasm/noise_fft.c` via `dart:ffi`

* Compile `src/wasm/noise_fft.c` (`compute_rms`, `rms_to_db`, `compute_fft_magnitude`) into `libworksphere_audio_dsp.so` (Android CMake/NDK) and a static/dynamic framework (iOS/macOS CocoaPods/SPM).
* Implement the `AdaptiveNoiseFilter` biquad cascade in the same native C/Rust DSP unit using standard RBJ Audio EQ Cookbook 2nd-order IIR coefficients (`highpass` + `notch`), avoiding Dart GC pauses on the audio thread.
* **Sample-Rate Change Reset Parity:** Mirror `AdaptiveNoiseFilter.resetFiltersIfSampleRateChanged()`. Whenever the OS audio route changes (e.g., speaker at `48 kHz` -> Bluetooth HFP at `16 kHz` or `44.1 kHz`), clamp target frequencies below Nyquist (`sampleRate / 2 - 1`), recompute biquad coefficients, and **zero filter delay lines (`z1 = 0, z2 = 0`)** before resuming processing.

### 2.2 Platform Channel Contract (`worksphere/audio_dsp`)

* **`MethodChannel('worksphere/audio_dsp')`:**
  * `startCapture({ int fftSize = 1024, double highPassHz = 150.0, List<double> notchHz = const [60, 120, 2400], double notchQ = 8.0, double deviceOffsetDb = 0.0 })`
  * `updateNotchConfig({ required double notchQ, required double dynamicNotchHz, required bool enabled })`
  * `stopCapture()`
* **`EventChannel('worksphere/audio_telemetry')`:** Emits throttled maps (`{ "decibels": double, "ambientNoiseFloorDb": double, "dominantNoiseFrequency": double?, "isSpeech": bool, "sampleRate": int }`) at ~20 Hz so the Flutter UI isolate never receives raw PCM buffers unnecessarily.

---

## 3. Microphone Permission Lifecycle

### 3.1 Platform Declarations

* **Android (`android/app/src/main/AndroidManifest.xml`):**
  ```xml
  <uses-permission android:name="android.permission.RECORD_AUDIO" />
  ```
* **iOS (`ios/Runner/Info.plist`):**
  ```xml
  <key>NSMicrophoneUsageDescription</key>
  <string>WorkSphere measures ambient room decibels and filters background noise during sessions without recording raw audio.</string>
  ```

### 3.2 Runtime Lifecycle & Interruption Handling

1. **Request on User Gesture Only:** Do not prompt at app launch. Invoke `Permission.microphone.request()` (`permission_handler`) only when the user taps **Start Measuring** or enables voice noise filtering.
2. **State Handling:**
   * `PermissionStatus.granted` -> call `startCapture()`.
   * `PermissionStatus.denied` -> display inline explanation and retry CTA.
   * `PermissionStatus.permanentlyDenied` / `restricted` -> display prompt with `openAppSettings()` action.
3. **Foreground/Background & OS Interruptions (`WidgetsBindingObserver`):**
   * On `AppLifecycleState.inactive` or `paused`, call `stopCapture()` immediately so Android/iOS mic privacy indicators turn off and battery is conserved.
   * On iOS, observe `AVAudioSession.interruptionNotification` (incoming phone call / Siri) and `routeChangeNotification` (headset plug/Bluetooth switch) to pause cleanly and trigger filter coefficient recalculation on resume.
4. **Widget Disposal:** Always cancel the `EventChannel` `StreamSubscription`, sustained-noise `Timer`, and invoke `stopCapture()` inside `State.dispose()`.
5. **Privacy Invariant:** Raw PCM buffers stay strictly inside native memory for frame-local RMS/FFT computation and are never written to disk or transmitted to WorkSphere servers (only aggregate `decibel` telemetry is posted).

---

## 4. dB Calibration & Hardware AGC Bypass

### 4.1 Disabling OS Pre-Processing

Web WorkSphere disables browser AGC/NS/AEC (`echoCancellation: false, autoGainControl: false, noiseSuppression: false`) so ambient measurements are not distorted. Flutter must configure native capture equivalently:

* **Android:** Use `MediaRecorder.AudioSource.UNPROCESSED` (API 24+, falling back to `VOICE_RECOGNITION` if `AudioManager.PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED` is `"false"`). Do **not** attach `AutomaticGainControl` or `NoiseSuppressor` effects to the measurement `AudioRecord` session.
* **iOS:** Configure `AVAudioSession` with category `.playAndRecord` (or `.record` for meter-only mode) and mode `.measurement` (`AVAudioSessionModeMeasurement`), which disables Apple's default voice-processing AGC and high-pass filtering.

### 4.2 Calibration Formula & Device Offset

Web maps normalized PCM `[-1.0, 1.0]` RMS via `dBFS = 20 * log10(rms)` and applies `+100.0 dB` (`src/wasm/noise_fft.c`). Because mobile MEMS microphones vary in sensitivity across vendors:

```text
dB_calibrated = clamp(20 * log10(max(rms, 1e-5)) + 100.0 + deviceCalibrationOffsetDb, 30.0, 120.0)
```

* **`deviceCalibrationOffsetDb`:** Defaults to `0.0` for `UNPROCESSED` / `.measurement` streams; configurable per device profile or user-calibrated against a reference SPL meter (typically within `-6.0 dB` to `+6.0 dB`), persisted locally via `SharedPreferences` alongside `SoundLevelMeter` alert preferences (`thresholdDb`, `muted`, `snoozedUntil`).
* **Threshold Evaluation:** Feed `dB_calibrated` into the same sustained-violation state machine (`thresholdDb` default `65 dB`, `sustainedDurationMs = 3000 ms`, snooze options `5 / 15 / 30 min`).
