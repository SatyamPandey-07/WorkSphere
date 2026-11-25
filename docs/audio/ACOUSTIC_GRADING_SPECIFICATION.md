# Acoustic Grading Specification: Noise Tiers, Sound Level Measurement and RT60

## Overview

WorkSphere grades the acoustic character of a venue so members can find a space that suits the kind of work they plan to do. This specification defines how a sound level is measured, how it maps to a tier, how reverberation time (RT60) is calculated, how the Web Audio `AnalyserNode` and the FFT worklets sample the signal, and how crowd-sourced readings should be taken.

It is written for acoustic telemetry contributors. Formulas and constants come from the source files listed in [Where the calculations live](#where-the-calculations-live). Where the code and the reference grading scale in this document differ, the difference is listed in [Conformance of existing implementations](#conformance-of-existing-implementations) instead of being hidden.

For the original meter thresholds and occupational limits, see [Real-Time Decibel Monitoring](./REALTIME_DECIBEL_MONITORING.md).

## Where the calculations live

There is no single `decibelCalculator` module. The calculations are spread over these files:

| Concern | File | What it does |
| --- | --- | --- |
| Live meter, RMS to dB | [`src/hooks/useDecibelMeter.ts`](../../src/hooks/useDecibelMeter.ts) | `calculateSafeRMS`, `computeSafeDecibels`, 5 second averaging, `AnalyserNode` setup. |
| Meter display | [`src/components/audio/SoundLevelMeter.tsx`](../../src/components/audio/SoundLevelMeter.tsx) | Shows a `decibels` value, handles the suspended `AudioContext` and the tap-to-start flow. It does not compute or classify levels. |
| A-weighting, Leq, percentiles, comfort class, noise dose | [`src/lib/acousticMetrics.ts`](../../src/lib/acousticMetrics.ts) | `calculateAWeightingGain`, `calculateLeq`, `calculateNoisePercentiles`, `classifyAcousticComfort`, `calculateDailyNoiseDose`. |
| RT60 | [`src/lib/audio/acousticRt60Calculator.ts`](../../src/lib/audio/acousticRt60Calculator.ts) | `calculateRt60FromImpulseResponse`, `calculateSabineRt60`. |
| RT60 ingestion API | [`src/app/api/venues/acoustics/rt60/route.ts`](../../src/app/api/venues/acoustics/rt60/route.ts) | Accepts crowd-sourced RT60 values. |
| FFT and Hann window | [`public/worklets/acoustic-privacy-fft-processor.js`](../../public/worklets/acoustic-privacy-fft-processor.js), [`public/worklets/fft-processor.js`](../../public/worklets/fft-processor.js) | 2048-point and 512-point frames with a Hann window. |
| Venue vibe votes | [`src/lib/venues/liveVibeTypes.ts`](../../src/lib/venues/liveVibeTypes.ts) | Member votes: `silent_focus`, `moderate_buzz`, `lively`. |

## Reference tier scale

This is the grading scale defined by this specification. Levels are in dB (A-weighted dBA wherever an A-weighted value is available).

| Tier | Level `L` | Intended use | Colour |
| --- | --- | --- | --- |
| **Deep Focus** | `L < 45 dB` | Reading, deep work, calls with no background noise. | Emerald |
| **Moderate Buzz** | `45 dB ≤ L ≤ 65 dB` | Background chatter, standard work, video calls. | Amber |
| **Collaborative** | `65 dB < L ≤ 80 dB` | Group work, workshops, active cafe seating. | Orange |
| **Loud** | `L > 80 dB` | Events and busy shared areas. Hearing protection is advisable for long stays. | Rose |

Boundary rule: a level of exactly 45 dB is Moderate Buzz, exactly 65 dB is still Moderate Buzz, and exactly 80 dB is still Collaborative. Deep Focus is strictly below 45 dB and Loud is strictly above 80 dB. This follows `getNoiseLevelCategory` in `AmbientNoiseSparkline.tsx`, which uses `dba < 45` and `dba <= 65`.

## Measuring a sound level

### Decibels from RMS (live meter)

`useDecibelMeter` reads time-domain samples from an `AnalyserNode` (`fftSize = 2048`, `getFloatTimeDomainData`) and computes, per animation frame:

```text
RMS = sqrt( (1 / n) × Σ x_i² )          over the finite samples only
dB  = clamp( 20 × log10( max(1e-5, RMS) ), 0, 120 )
```

`calculateSafeRMS` skips `NaN` and infinite samples and returns 0 for an empty, silent, or all-invalid buffer. `computeSafeDecibels` returns 0 for a non-finite or non-positive RMS.

A measurement lasts **5 seconds**. Each frame's dB value is collected, and when 5 seconds have elapsed the reported value is the arithmetic mean of the per-frame dB values (not an energy mean), clamped to 0 to 120 and rounded to one decimal. While the measurement runs, the latest frame value is shown as live feedback.

The microphone is opened with `echoCancellation`, `autoGainControl` and `noiseSuppression` all set to `false`, so the browser does not flatten the level being measured. The analyser is not connected to `AudioContext.destination`, so no audio is played back, and only the resulting number leaves the measurement code.

### Calibration limitation

Float samples from `getFloatTimeDomainData` are normalised to the range -1 to 1, so their RMS is at most 1 and `20 × log10(RMS)` is at most 0 dBFS. After the `[0, 120]` clamp, **every normalised microphone signal maps to 0 dB**:

| RMS | `20 × log10(RMS)` | Reported dB |
| ---: | ---: | ---: |
| 0.1 | -20 | 0 |
| 1 | 0 | 0 |
| 10 | 20 | 20 |
| 1000 | 60 | 60 |

Only values above 1 produce non-zero output, so the function is correct as a unit-level helper but needs a calibration offset (the dB value of digital full scale for the device) before its output can be compared with the SPL tier boundaries. The FFT worklet `fft-processor.js` does apply an offset: `splDb = clamp(20 × log10(RMS) + 100, 20, 120)`, with `-100` dBFS used for near-silence (`RMS ≤ 1e-6`). Contributors adding a calibrated meter should reuse one offset convention everywhere.

### A-weighting

Human hearing is less sensitive to low and very high frequencies, so levels for grading should be A-weighted (dBA). `calculateAWeightingGain(f)` implements the IEC 61672-1 curve:

```text
R_A(f) = 12194² × f⁴ / [ (f² + 20.6²) × sqrt( (f² + 107.7²)(f² + 737.9²) ) × (f² + 12194²) ]
A(f)   = 20 × log10( R_A(f) ) + 1.9997          [dB]
```

The `+1.9997` offset makes `A(1000 Hz) = 0 dB`. The gain is `-Infinity` for a frequency of 0 or below. `applyAWeightingToSpectrum` adds `A(f)` to a dB spectrum, or multiplies a linear spectrum by `10^(A(f) / 20)`.

### Equivalent continuous level (Leq)

For a set of per-frame levels `L_i`, `calculateLeq` sums energy, not decibels:

```text
Leq = 10 × log10( (1 / N) × Σ 10^(L_i / 10) )
```

Non-finite frames are ignored. With no valid frames, or zero mean energy, the function returns the noise floor (default 30 dB). The result is rounded to one decimal by default.

Example: frames of 40 dB and 60 dB give `10 × log10((10⁴ + 10⁶) / 2) = 57.0 dB`, not the arithmetic mean of 50 dB. Loud moments dominate Leq, which matches how they are heard.

### Statistical levels (L10, L50, L90)

`calculateNoisePercentiles` sorts the frames in descending order and linearly interpolates the level that is exceeded for `p` percent of the time:

| Statistic | Meaning |
| --- | --- |
| `L10` | Exceeded 10% of the time. Intermittent peaks such as doors or sirens. |
| `L50` | Median level. |
| `L90` | Background noise floor, free of short events. |
| `Intrusiveness` | `max(0, L10 - L90)`. A large value means the venue is quiet but punctuated by loud events. |

With no valid frames every statistic is 30 and intrusiveness is 0.

### Comfort classification

`classifyAcousticComfort(leq, l90?)` grades a venue from its Leq, raised to the background floor when one is supplied:

```text
effective = max(Leq, L90)        (L90 ignored when missing or invalid)
```

An invalid or negative `leq` is replaced by 30 dBA. The categories are:

| Category | Effective level | Focus suitability | Suggested session length |
| --- | --- | --- | --- |
| `deep_focus` | `< 50 dBA` | ideal | unlimited |
| `conversational` | `< 65 dBA` | acceptable | 480 min |
| `lively` | `< 75 dBA` | limited | 180 min |
| `hazardous_loud` | `≥ 75 dBA` | unsuitable | 45 min |

### Noise dose

`calculateDailyNoiseDose(decibelLevel, durationMinutes, standard)` converts a level and an exposure duration in minutes into a share of the daily allowance, returning `dosePercentage`, `exposureHours`, `allowableHours`, `timeWeightedAverage`, `standard` and `isExceeded`. The permitted time at level `L` is:

```text
NIOSH:  T = 8 / 2^((L - 85) / 3)  hours      (criterion 85 dBA, 3 dB exchange rate)
OSHA:   T = 8 / 2^((L - 90) / 5)  hours      (criterion 90 dBA, 5 dB exchange rate)
```

Example: at 88 dBA the NIOSH permitted time is `8 / 2^1 = 4` hours, so 2 hours at that level uses 50% of the daily dose.

## Sampling and windowing

### Sample rate and frame geometry

The sample rate `f_s` is `AudioContext.sampleRate`, typically 44,100 or 48,000 Hz. For an FFT of size `N`:

```text
bin width   Δf = f_s / N
frame time  T  = N / f_s
```

| Component | `N` | `Δf` at 48 kHz | Frame time at 48 kHz |
| --- | ---: | ---: | ---: |
| `acoustic-privacy-fft-processor.js` (SIMD FFT) | 2048 | 23.4375 Hz | 42.67 ms |
| `fft-processor.js` (spectral analyzer) | 512 | 93.75 Hz | 10.67 ms |
| `AmbientNoiseSpectrumVisualizer` analyser | 256 | 187.5 Hz | 5.33 ms |

### Hann window

Both FFT worklets multiply each frame by a Hann window before transforming it, which reduces spectral leakage from the frame edges:

```text
w[n] = 0.5 × ( 1 - cos( 2π × n / (N - 1) ) ),   n = 0 … N - 1
```

The window is precomputed once per worklet. The Hann window has a coherent gain of 0.5, which is why a sine of amplitude `A` shows a peak near `0.5 × A` in the worklet's linear output.

### AnalyserNode

A native `AnalyserNode` does its own windowing: the Web Audio specification applies a Blackman window internally, and it cannot be changed. The Hann window therefore applies only to the worklet path. Settings used in the code:

| Where | Setting | Value |
| --- | --- | --- |
| `useDecibelMeter` | `fftSize` | 2048, read with `getFloatTimeDomainData` for RMS |
| `AmbientNoiseSpectrumVisualizer` | `fftSize` / `smoothingTimeConstant` | 256 / 0.8 |
| `AmbientNoiseSpectrumVisualizer` | `minDecibels` / `maxDecibels` | -90 / -10, read with `getByteFrequencyData` |
| `useAcousticSpectrum` | frequency data | `getFloatFrequencyData` (dB per bin) |

`smoothingTimeConstant = 0.8` blends each frame with the previous one, so displayed bars lag real changes. Use 0 when a raw per-frame value is needed for grading.

## Reverberation time (RT60)

RT60 is the time it takes sound in a room to decay by 60 dB after the source stops. Long RT60 values make speech hard to follow and degrade call quality, so RT60 is collected per zone alongside the level. No code combines RT60 and dB into a tier: RT60 feeds the venue's call-quality score separately.

### From an impulse response (Schroeder integration)

`calculateRt60FromImpulseResponse(impulseResponse, sampleRate)` measures decay from a recorded room impulse response `h[n]`:

1. Integrate the squared response backwards from the end to each sample, giving the energy still to come, `E[n] = Σ_{k=n}^{N-1} h[k]²`.
2. Convert to a decay curve relative to the total energy, `L[n] = 10 × log10( E[n] / E[0] )` dB.
3. Find the first sample where `L[n] ≤ -5 dB`, at time `t₅ = n / f_s`, and the first sample where `L[n] ≤ -25 dB`, at time `t₂₅`.
4. Extrapolate the 20 dB span to 60 dB:

```text
RT60 = 3 × ( t₂₅ - t₅ )
```

The result is never below `MIN_RT60_SECONDS = 0.05` s. The function returns `null` when the input is empty or shorter than 2 samples, contains non-finite values, has no energy, the sample rate is invalid, or the decay never reaches -25 dB. The calculation takes the first crossing of each threshold. It does not fit a regression line.

### From room geometry (Sabine)

`calculateSabineRt60({ volumeM3, surfaces })` estimates RT60 from the room volume and its surfaces:

```text
RT60 = 0.161 × V / A,      A = Σ ( S_i × α_i )
```

`V` is the volume in cubic metres, `S_i` the area of each surface in square metres, and `α_i` its absorption coefficient from 0 to 1. The result is clamped to at least 0.05 s. It returns `null` for a non-positive or non-finite volume, an empty surface list, a non-positive area, an absorption outside `[0, 1]`, or zero total absorption.

Example: a 10 m × 8 m × 3 m room (`V = 240 m³`) with a carpeted floor (80 m², α 0.3), acoustic ceiling tiles (80 m², α 0.6) and painted walls (108 m², α 0.1):

```text
A    = 80 × 0.3 + 80 × 0.6 + 108 × 0.1 = 82.8 m²
RT60 = 0.161 × 240 / 82.8             = 0.467 s
```

### Ingestion

`POST /api/venues/acoustics/rt60` accepts `{ venueId, zoneId, rt60, coordinates }`. It returns `400` unless `venueId` and `zoneId` are present and `rt60` is a finite number greater than 0, and it raises any accepted value below 0.05 s to 0.05 s. At the time of writing the endpoint logs the value and does not persist it, and `GET` returns a fixed sample heatmap, so the stored RT60 map is not yet backed by real data.

## Guidelines for crowd-sourced ambient readings

A reading is only useful for grading if it is repeatable. Ask contributors to follow these steps:

1. **Use the built-in meter.** It disables echo cancellation, automatic gain control and noise suppression. Another recording app may silently flatten the level.
2. **Let the full 5 second measurement finish.** The reported value is the mean of that window, and stopping early gives a single frame.
3. **Hold the device still, microphone uncovered,** at seated working height near the desk or zone being graded, away from a phone speaker, fan or keyboard.
4. **Take at least three readings at different times of day** (for example morning, midday and late afternoon) and avoid special events, so the grade reflects normal use.
5. **Prefer Leq over a single reading.** If several readings are combined, use `calculateLeq`, not an arithmetic mean, and report `L90` as the noise floor.
6. **Discard readings taken while the `AudioContext` is suspended.** `SoundLevelMeter` shows `-- dB` in that state and asks the user to tap to start.
7. **Add a vibe vote when you can.** Member votes (`silent_focus`, `moderate_buzz`, `lively`) catch what a short measurement misses, such as intermittent peaks.
8. **Do not store or send audio.** Only the resulting level, zone and time should be submitted.

For RT60, submit the value computed from a recorded impulse response (a hand clap or balloon pop is a common source), per zone, and note the zone it was taken in.

## Conformance of existing implementations

The codebase currently contains several tier schemes with different boundaries. They all agree that quiet is below roughly 45 to 50 dB, but the upper boundaries differ.

| Location | Boundaries | Tier names |
| --- | --- | --- |
| This specification | 45 / 65 / 80 dB | Deep Focus, Moderate Buzz, Collaborative, Loud |
| `AmbientNoiseSparkline.tsx` (`getNoiseLevelCategory`) | 45 / 65 dBA | Quiet Focus, Moderate Buzz, Lively / Loud |
| [`REALTIME_DECIBEL_MONITORING.md`](./REALTIME_DECIBEL_MONITORING.md) | 45 / 65 dB | Quiet, Moderate, Loud |
| `acousticMetrics.ts` (`classifyAcousticComfort`) | 50 / 65 / 75 dBA | `deep_focus`, `conversational`, `lively`, `hazardous_loud` |
| `AmbientNoiseSpectrumVisualizer.tsx` | 45 / 62 / 74 dB | Deep Focus (Quiet), Gentle Ambience, Lively Workspace, Energetic / High Energy |
| `acousticGradientEngine.ts` (`decibelsToRgba`, heatmap colours) | 38 / 46 / 56 dB | Deep Focus, Gentle, Amber Buzz, Noise Hazard |

Until these are consolidated into one shared tier module, a contributor changing a boundary should update this table and every scheme that is meant to represent the same tier.

## Known limitations

- The live meter helper clamps every normalised signal to 0 dB, see [Calibration limitation](#calibration-limitation).
- Several tier schemes exist, see [Conformance of existing implementations](#conformance-of-existing-implementations).
- RT60 uses a first-crossing T20 estimate on one impulse response, and the ingestion endpoint is a stub.
- The 5 second meter window averages decibels, which understates short loud events compared with Leq.
