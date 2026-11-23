# Ambient Noise Spectrogram Architecture

**Audience:** Contributors and maintainers working on audio visualization, Web Audio integration, and venue acoustic monitoring.

**Scope:** Microphone capture, FFT frequency analysis, spectrum rendering, rolling waterfall visualization, audio lifecycle management, visibility handling, and troubleshooting.

**Primary implementation:**

- `src/components/noise/NoiseSpectrogram.tsx`
- `src/lib/noise/fftSpectrogram.ts`

---

## 1. Overview

WorkSphere provides a browser-based ambient noise visualization that captures microphone input and renders a real-time frequency spectrum and rolling waterfall spectrogram.

The implementation uses the Web Audio API's `AudioContext`, `MediaStreamAudioSourceNode`, and `AnalyserNode`.

The visualization operates entirely in the browser. The component does not upload microphone audio or persist captured audio.

Its primary responsibilities are:

- Request microphone access after explicit user interaction.
- Convert microphone input into frequency-domain data.
- Calculate approximate live and peak noise levels.
- Classify the current level as Quiet, Moderate, or Loud.
- Render frequency spectrum bars.
- Maintain a scrolling frequency-history waterfall.
- Stop audio capture when the component is no longer visible or when battery-saving conditions require it.
- Release media tracks, audio nodes, and animation resources when stopped or unmounted.

### 1.1 Implementation boundaries

The issue description mentions several architectural features that are not implemented in the current source.

The following table distinguishes the requested architecture from the actual implementation.

| Area                                         | Current implementation                                                                       |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| FFT size                                     | 2048                                                                                         |
| Frequency analysis                           | Web Audio `AnalyserNode`                                                                     |
| Spectrum rendering                           | HTML Canvas 2D                                                                               |
| Waterfall rendering                          | HTML Canvas 2D with pixel-column scrolling                                                   |
| Frame scheduling                             | `requestAnimationFrame`, limited to approximately 60 FPS                                     |
| Color mapping                                | One custom piecewise RGB intensity function                                                  |
| Microphone processing                        | Browser-side processing                                                                      |
| Background handling                          | Stops capture when the document is hidden                                                    |
| Battery handling                             | Stops capture when supported battery status is at or below 20% and the device is discharging |
| Viewport handling                            | Stops capture when the component leaves the viewport                                         |
| Web Workers                                  | Not implemented in this component                                                            |
| OffscreenCanvas                              | Not implemented                                                                              |
| Canvas double buffering                      | Not implemented                                                                              |
| Named Viridis, Inferno, Cyberpunk palettes   | Not implemented                                                                              |
| Automatic battery-based frame-rate reduction | Not implemented                                                                              |

Do not document proposed architecture as an existing production feature.

---

## 2. Component Map

### 2.1 Primary FFT waterfall implementation

File:

`src/components/noise/NoiseSpectrogram.tsx`

This component implements the canvas-based visualization.

Its responsibilities include microphone initialization, audio analysis, frame scheduling, noise classification, canvas rendering, and cleanup.

The helper functions are provided by:

`src/lib/noise/fftSpectrogram.ts`

### 2.2 Separate three-band visualization

WorkSphere also contains:

`src/components/audio/NoiseSpectrogram.tsx`

This is a different component that calculates average energy in three frequency ranges:

- Low: below 300 Hz.
- Mid: 300–3000 Hz.
- High: above 3000 Hz.

It uses `getByteFrequencyData()` and renders three horizontal energy meters.

It does not implement the canvas waterfall renderer.

The two components have different APIs and rendering strategies. Avoid treating them as interchangeable.

### 2.3 Current venue integration

The current `VenueNoiseSection.tsx` imports:

```tsx
import { NoiseSpectrogram } from "@/components/audio/NoiseSpectrogram";
```

It renders that component inside the `noise-spectrogram-container`.

Therefore, the venue details view currently uses the three-band implementation, not the canvas-based waterfall component described in the main architecture sections below.

The canvas implementation has its own component tests and is exported through the noise component index, but it is not the component imported by `VenueNoiseSection.tsx` in the current implementation.

This distinction should be considered when changing component imports or consolidating the two implementations.

---

## 3. Architecture and Processing Pipeline

The canvas-based implementation follows this processing pipeline:

```text
                 User presses Start
                         |
                         v
             navigator.mediaDevices
                  .getUserMedia()
                         |
                         v
                Microphone MediaStream
                         |
                         v
                    AudioContext
                         |
                         v
               MediaStreamAudioSource
                         |
                         v
                    AnalyserNode
                    fftSize 2048
                         |
                         v
              getFloatFrequencyData()
                         |
                         v
                 Float32Array bins
                         |
             +-----------+-----------+
             |                       |
             v                       v
       Peak level              Average level
             |                       |
             v                       v
       Peak display            Noise classification
             |                       |
             +-----------+-----------+
                         |
                         v
                 requestAnimationFrame
                   ~60 FPS maximum
                         |
             +-----------+-----------+
             |                       |
             v                       v
       Spectrum bars           Waterfall column
             |                       |
             v                       v
         Canvas 2D                Canvas 2D
```

The component also uses two lifecycle utilities:

- `useWebAudioAutoPause` handles document visibility and battery conditions.
- `useElementVisibility` tracks document visibility and viewport intersection.

These utilities control whether audio capture and visual updates should continue.

---

## 4. Microphone Initialization

The microphone is initialized only when the user presses the Start Spectrogram button.

The component requests an audio stream using:

```typescript
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
});
```

These constraints disable browser-provided echo cancellation, noise suppression, and automatic gain control when supported by the browser.

This is useful when analyzing environmental frequency characteristics because automatic processing can alter the captured signal.

### 4.1 AudioContext construction

The component attempts to use the standard browser constructor and then the WebKit-prefixed fallback:

```typescript
const AudioContextClass =
  window.AudioContext ||
  (
    window as typeof window & {
      webkitAudioContext?: typeof AudioContext;
    }
  ).webkitAudioContext;
```

If neither constructor exists, initialization fails with:

```text
Web Audio API is not supported
```

A new `AudioContext` is created.

If its state is suspended, the component awaits `resume()` before connecting the microphone source.

### 4.2 AnalyserNode configuration

The analyser is configured as follows:

```typescript
const analyser = audioContext.createAnalyser();

analyser.fftSize = FFT_SIZE;
analyser.smoothingTimeConstant = 0.7;
analyser.minDecibels = -100;
analyser.maxDecibels = -10;
```

The configuration is defined by the implementation helper constants.

| Setting                 | Value | Purpose                                    |
| ----------------------- | ----: | ------------------------------------------ |
| `fftSize`               |  2048 | Frequency analysis resolution              |
| `smoothingTimeConstant` |   0.7 | Smooth frequency-bin transitions           |
| `minDecibels`           |  -100 | Lower analyser display bound               |
| `maxDecibels`           |   -10 | Upper analyser display bound               |
| `frequencyBinCount`     |  1024 | Number of frequency bins for FFT size 2048 |

The source node connects directly to the analyser:

```typescript
const source = audioContext.createMediaStreamSource(stream);
source.connect(analyser);
```

The component does not connect this analysis graph to the audio destination.

---

## 5. FFT Data Processing

Implementation:

`src/lib/noise/fftSpectrogram.ts`

The FFT helper module defines the processing constants and numerical transformations used by the visualization.

### 5.1 FFT configuration

```typescript
export const FFT_SIZE = 2048;
export const TARGET_FPS = 60;
export const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;
```

For a 2048-point FFT, Web Audio exposes 1024 frequency-domain bins.

The actual frequency represented by each bin depends on the audio context sample rate.

The frequency spacing is:

\[
\Delta f = \frac{f_s}{N}
\]

where:

- \(f_s\) is the audio sample rate.
- \(N\) is the FFT size.

For example, at 48 kHz:

\[
\Delta f = \frac{48000}{2048}
= 23.4375\ \text{Hz}
\]

The implementation obtains the sample rate from the active `AudioContext`.

For additional FFT and bin-mapping mathematics, see the [WebAudio FFT Spectrogram Mathematical Reference](../WEBAUDIO_FFT_SPECTROGRAM_REFERENCE.md).

### 5.2 Frequency-domain data acquisition

The component allocates a floating-point buffer:

```typescript
const bins = new Float32Array(analyser.frequencyBinCount);
```

During each eligible animation frame, it reads:

```typescript
analyser.getFloatFrequencyData(bins);
```

The resulting values represent frequency-bin levels in decibels relative to digital full scale (dBFS).

They are subsequently used for peak calculation, averaging, noise classification, and canvas rendering.

### 5.3 Peak level calculation

`peakDbFromFrequencyBins()` finds the highest finite frequency-bin value.

It then applies the application's display mapping:

```typescript
Math.max(20, Math.min(120, Math.round((peak + 100) * 10) / 10));
```

When no finite frequency values are available, the helper returns 20.

The result is displayed as the peak level for the current capture session.

### 5.4 Average level calculation

`averageDbFromFrequencyBins()`:

1. Filters out non-finite values.
2. Sorts the remaining frequency-bin values in descending order.
3. Selects the eight highest values by default.
4. Calculates their arithmetic mean.
5. Applies the same approximate 20–120 display mapping.

The helper accepts a configurable `topN` argument, defaulting to 8.

Using the strongest bins reduces the influence of weaker frequency bins on the displayed average.

### 5.5 Noise classification

The helper classifies the mapped average level:

| Condition                | Classification |
| ------------------------ | -------------- |
| Below 45                 | Quiet          |
| 45 through 65, inclusive | Moderate       |
| Above 65                 | Loud           |

The component displays the classification as a colored status badge.

These values are application display thresholds. They should not be interpreted as calibrated acoustic measurements.

### 5.6 dBFS versus calibrated dB SPL

An important distinction:

`AnalyserNode.getFloatFrequencyData()` returns frequency-domain levels in dBFS, not directly calibrated sound-pressure levels in dB SPL.

The helper's offset and clamping provide an application display scale. They do not establish a physical sound-pressure reference.

Accurate dB SPL measurement would require microphone and device calibration.

For the existing application noise thresholds, see [Real-Time Decibel Monitoring](./REALTIME_DECIBEL_MONITORING.md).

---

## 6. Spectrum Rendering

The component uses a regular HTML canvas and its 2D rendering context.

The spectrum canvas has the following intrinsic dimensions:

| Property |  Value |
| -------- | -----: |
| Width    | 640 px |
| Height   | 120 px |

### 6.1 Drawing behavior

`drawSpectrumBars()`:

1. Obtains the canvas 2D context.
2. Clears the previous frame using a dark background fill.
3. Skips the DC bin.
4. Selects a maximum of 96 frequency bars.
5. Normalizes each selected bin.
6. Calculates the corresponding bar height.
7. Obtains the RGB color from `spectrogramColor()`.
8. Draws the bar using `fillRect()`.

The bar height is determined from the normalized frequency intensity.

The renderer samples a subset of available frequency bins instead of drawing all 1023 non-DC bins individually.

### 6.2 Canvas rendering

The spectrum renderer uses:

```typescript
canvas.getContext("2d");
```

The implementation does not use `OffscreenCanvas`, WebGL, or a separate rendering worker.

---

## 7. Rolling Waterfall Spectrogram

The waterfall canvas has these intrinsic dimensions:

| Property |  Value |
| -------- | -----: |
| Width    | 640 px |
| Height   | 160 px |

Each new frequency frame produces a one-pixel-wide vertical column.

### 7.1 Waterfall update procedure

`drawWaterfallColumn()` performs the following operations:

1. Obtains the canvas 2D context.
2. Reads the existing image, excluding the first column.
3. Moves the existing image one pixel to the left.
4. Creates a new one-pixel-wide image column.
5. Maps frequency-bin values to normalized intensities.
6. Converts each intensity into RGB values.
7. Writes the new column at the right edge of the canvas.

The implementation uses:

```typescript
const image = ctx.getImageData(1, 0, width - 1, height);

ctx.putImageData(image, 0, 0);
```

It then creates and writes the new column with:

```typescript
const col = ctx.createImageData(1, height);

ctx.putImageData(col, width - 1, 0);
```

The frequency mapping places lower frequencies near the bottom and higher frequencies near the top.

The result is a scrolling frequency-history view.

### 7.2 Buffering limitations

The implementation uses the existing canvas image as its scrolling history.

It does not maintain two alternating canvas buffers and does not use `OffscreenCanvas`.

Changes involving double buffering, GPU acceleration, or off-main-thread rendering would require a separate implementation change.

---

## 8. Color Mapping

Implementation:

`src/lib/noise/fftSpectrogram.ts`

The renderer uses a custom continuous RGB intensity mapping:

```typescript
spectrogramColor(t);
```

The input value is clamped to the interval from 0 to 1.

The mapping has three piecewise linear interpolation segments.

| Normalized intensity | Approximate RGB control point | Visual character |
| -------------------- | ----------------------------- | ---------------- |
| 0.00                 | `[10, 20, 80]`                | Dark blue        |
| 0.33                 | `[30, 120, 200]`              | Blue             |
| 0.66                 | `[250, 200, 40]`              | Yellow-orange    |
| 1.00                 | `[250, 40, 20]`               | Red              |

The implementation calculates intermediate colors through linear interpolation within each segment.

These are RGB control points for one intensity function, not four selectable palettes.

The current component does not expose palette-selection props or separate Viridis, Inferno, or Cyberpunk palettes.

### 8.1 Related three-band visualization colors

The separate `src/components/audio/NoiseSpectrogram.tsx` uses fixed Tailwind utility classes:

| Frequency band | UI color class  |
| -------------- | --------------- |
| Low            | `bg-sky-400`    |
| Mid            | `bg-violet-400` |
| High           | `bg-rose-400`   |

These colors belong to the separate three-band meter and are not the waterfall color mapping.

---

## 9. Frame Scheduling and Rendering Performance

The component uses `requestAnimationFrame()` to schedule frequency analysis and rendering.

The helper defines:

```typescript
export const TARGET_FPS = 60;
export const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;
```

The loop compares the elapsed time with the target frame interval.

If insufficient time has elapsed, it schedules another animation frame without performing the full analysis and drawing operation.

This limits the processing cadence to approximately 60 FPS.

### 9.1 State update throttling

In addition to frame scheduling, the component avoids unnecessary React state updates.

It maintains `lastDrawnDbRef` and updates the displayed level, peak level, and classification when:

- No previous level has been drawn; or
- The average level differs from the previously drawn value by at least 0.5.

The spectrum and waterfall are updated in the same visible update path.

### 9.2 Visibility handling

The component uses:

`useElementVisibility()`

This hook tracks:

- Document visibility.
- Element viewport intersection.

The intersection observer uses a threshold of 0.05.

The component maintains an `isVisibleRef` and checks it before updating visual output.

If the component is running and is no longer in the viewport, it calls `stop()`.

When the document is hidden, the separate audio auto-pause hook stops capture.

### 9.3 Battery handling

The component uses:

`useWebAudioAutoPause()`

The hook defaults to a battery threshold of 0.20.

It triggers the pause callback when:

- The browser document becomes hidden; or
- Battery status is supported, the device is discharging, and the battery level is at or below 20%.

The callback stops microphone capture and resets the component to its idle state.

The current component does not implement automatic frame-rate reduction based on battery level.

It stops the capture operation instead.

### 9.4 Resume behavior

Automatic resumption is not implemented.

After the capture is stopped by visibility or battery handling, the user must press Start Spectrogram again.

The component does not provide an `onResume` callback to the auto-pause hook.

---

## 10. Component API and UI State

### 10.1 Props

The canvas-based component:

`src/components/noise/NoiseSpectrogram.tsx`

does not currently accept public props.

Its configuration comes from the shared FFT helper constants.

The similarly named component under `src/components/audio/` has a separate API:

```typescript
export interface NoiseSpectrogramProps {
  className?: string;
  fftSize?: number;
}
```

Its default FFT size is 2048.

Do not apply that API description to the canvas-based component.

### 10.2 Internal states

The canvas component uses four status values:

| State        | Meaning                                                         |
| ------------ | --------------------------------------------------------------- |
| `idle`       | Microphone capture is inactive.                                 |
| `requesting` | Microphone permission and audio initialization are in progress. |
| `running`    | Audio capture and spectrum processing are active.               |
| `error`      | Microphone or analyser initialization failed.                   |

The Start button is disabled while the status is `requesting`.

While running, the component shows a Stop button.

### 10.3 Display elements

The running interface contains:

- Live level in the mapped dB display scale.
- Peak level.
- Quiet, Moderate, or Loud classification.
- Frequency spectrum canvas.
- Rolling waterfall canvas.
- Stop control.

The initial interface does not request microphone access automatically.

---

## 11. Microphone Permissions and Error Handling

Microphone capture requires an explicit user action.

The component requests access through `navigator.mediaDevices.getUserMedia()`.

### 11.1 Permission denial

If the browser rejects the microphone request, the component:

1. Catches the initialization error.
2. Logs the failure with the `[NoiseSpectrogram] mic/analyser failed:` prefix.
3. Changes the component status to `error`.
4. Displays a microphone access failure message.

The current implementation uses a generic UI message:

```text
Microphone access failed. Check permissions and try again.
```

It does not provide dedicated UI messages for every possible browser exception.

### 11.2 Unsupported audio environment

If no standard or WebKit-prefixed AudioContext constructor exists, initialization fails.

The component enters its error state and displays the same general microphone failure guidance.

### 11.3 Error boundary distinction

The component uses local React state for error presentation.

It does not currently declare or integrate a dedicated React Error Boundary.

The displayed error state covers caught asynchronous microphone and analyser initialization failures. It should not be treated as a general boundary for every possible rendering or runtime exception.

### 11.4 Security and data handling

The component:

- Captures microphone input only after a user presses Start.
- Processes frequency data locally in the browser.
- Does not issue network requests to upload microphone audio.
- Does not persist captured audio.
- Stops media tracks when the capture is stopped or the component is unmounted.

Microphone permission should be granted only in contexts where users understand why audio access is required.

---

## 12. Cleanup and Resource Lifecycle

Cleanup is important because a live microphone stream and animation loop can consume system resources after a component is no longer needed.

The cleanup function:

1. Cancels the outstanding animation frame.
2. Disconnects the media stream source.
3. Disconnects the analyser.
4. Stops every microphone media track.
5. Closes the AudioContext if it is not already closed.

The component stores the cleanup function in `cleanupRef`.

The Stop handler invokes it and resets the component to `idle`.

A separate effect invokes cleanup on unmount.

### Resource ownership

| Resource            | Cleanup operation        |
| ------------------- | ------------------------ |
| Animation frame     | `cancelAnimationFrame()` |
| Media stream source | `disconnect()`           |
| AnalyserNode        | `disconnect()`           |
| MediaStream tracks  | `track.stop()`           |
| AudioContext        | `close()`                |

Closing the AudioContext is asynchronous. The implementation catches close failures during cleanup to avoid an unhandled rejection.

---

## 13. Troubleshooting

| Symptom                                   | Likely cause                                       | First check                                   |
| ----------------------------------------- | -------------------------------------------------- | --------------------------------------------- |
| Start control does not initialize capture | Microphone permission denied                       | Browser microphone permissions                |
| Microphone request fails                  | Device unavailable or browser restriction          | `navigator.mediaDevices.getUserMedia`         |
| Audio analysis cannot start               | AudioContext unsupported or initialization failure | Browser Web Audio support                     |
| No meaningful spectrum activity           | Quiet input, disabled microphone, or signal issue  | Microphone input and browser device selection |
| Waterfall is not updating                 | Capture is inactive or component is not visible    | Component status and visibility               |
| Visualization stops after switching tabs  | Document visibility auto-pause                     | Return to the page and press Start            |
| Visualization stops at low battery        | Battery auto-pause condition                       | Battery level and charging state              |
| Visualization stops after scrolling away  | Component is outside the viewport                  | Scroll back and press Start                   |
| Repeated initialization failures          | Permission or device problem                       | Browser console and microphone settings       |

### 13.1 Browser console checks

Check whether microphone access is exposed:

```javascript
console.log(
  "getUserMedia available:",
  Boolean(navigator.mediaDevices?.getUserMedia),
);
```

Check the AudioContext implementation:

```javascript
console.log({
  audioContext: typeof window.AudioContext,
  webkitAudioContext: typeof window.webkitAudioContext,
});
```

Check browser permission status where supported:

```javascript
const permission = await navigator.permissions.query({
  name: "microphone",
});

console.log("Microphone permission:", permission.state);
```

Permission-query support varies by browser. The actual `getUserMedia()` request remains the authoritative check.

---

## 14. Test Coverage

The relevant tests are:

| Test file                                                 | Coverage                                                                                                 |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/__tests__/components/NoiseSpectrogram.test.tsx`      | Canvas component rendering and microphone-to-analyser initialization                                     |
| `src/__tests__/lib/fftSpectrogram.test.ts`                | FFT configuration, noise classification, peak and average calculations, normalization, and color mapping |
| `src/__tests__/components/audio/NoiseSpectrogram.test.ts` | Three-band frequency-energy calculation for the separate audio component                                 |

### Focused test commands

Canvas component:

```powershell
npx jest src/__tests__/components/NoiseSpectrogram.test.tsx --runInBand
```

FFT helpers:

```powershell
npx jest src/__tests__/lib/fftSpectrogram.test.ts --runInBand
```

Three-band helper:

```powershell
npx jest src/__tests__/components/audio/NoiseSpectrogram.test.ts --runInBand
```

The canvas component tests mock microphone access, AudioContext, AnalyserNode, canvas rendering, and animation-frame scheduling.

The tests do not require physical microphone hardware.

---

## 15. Related Documentation

- [WebAudio FFT Spectrogram Mathematical Reference](../WEBAUDIO_FFT_SPECTROGRAM_REFERENCE.md) — FFT mathematics, frequency-bin interpretation, decibel normalization, and canvas mapping.
- [Real-Time Decibel Monitoring](./REALTIME_DECIBEL_MONITORING.md) — application noise-level thresholds and acoustic monitoring guidance.
- [WebAssembly SIMD Acoustic Pipeline](./WASM_SIMD_ACOUSTICS.md) — the separate AudioWorklet and WebAssembly acoustic-processing architecture.

## 16. Implementation References

| Concern                          | Source                                                   |
| -------------------------------- | -------------------------------------------------------- |
| Canvas-based spectrogram         | `src/components/noise/NoiseSpectrogram.tsx`              |
| Three-band visualization         | `src/components/audio/NoiseSpectrogram.tsx`              |
| FFT and color helpers            | `src/lib/noise/fftSpectrogram.ts`                        |
| Automatic audio pause            | `src/hooks/useWebAudioAutoPause.ts`                      |
| Document and viewport visibility | `src/hooks/useElementVisibility.ts`                      |
| Venue noise section integration  | `src/components/chat/venue-dialog/VenueNoiseSection.tsx` |
| FFT helper tests                 | `src/__tests__/lib/fftSpectrogram.test.ts`               |
| Canvas component tests           | `src/__tests__/components/NoiseSpectrogram.test.tsx`     |
