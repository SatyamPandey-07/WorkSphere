# WebAudio FFT Spectrogram Mathematical Reference

This reference explains the mathematics used to convert Web Audio frequency
data into spectrum bars and scrolling spectrogram pixels in WorkSphere.

It covers:

- discrete Fourier transform and FFT bin interpretation;
- Hann ("Hanning") and four-term Blackman–Harris windows;
- frequency resolution and bin-to-frequency conversion;
- decibel normalization;
- canvas bar-height and spectrogram-row mapping;
- implementation guidance for `AnalyserNode`;
- common numerical and rendering mistakes.

The repository currently uses:

```ts
export const FFT_SIZE = 2048;
```

and normalizes frequency-domain decibel values through:

```ts
normalizeBinDb(dbfs, minDb, maxDb);
```

from:

```text
src/lib/noise/fftSpectrogram.ts
```

---

## 1. Signal model

A browser microphone or other `AudioNode` produces a discrete-time sequence:

\[
x[n], \qquad n = 0,1,\ldots,N-1
\]

where:

- \(x[n]\) is the sampled audio amplitude;
- \(N\) is the FFT size;
- \(f_s\) is the sample rate in hertz.

For a common Web Audio sample rate:

\[
f_s = 48{,}000\ \text{Hz}
\]

and the WorkSphere FFT size:

\[
N = 2048
\]

the analysis window duration is:

\[
T = \frac{N}{f_s}
= \frac{2048}{48000}
\approx 0.04267\ \text{s}
= 42.67\ \text{ms}
\]

A larger FFT gives narrower frequency bins, but represents a longer section of
audio and therefore reacts more slowly to rapid changes.

---

## 2. Discrete Fourier transform

The discrete Fourier transform of a frame \(x[n]\) is:

\[
X[k] =
\sum_{n=0}^{N-1}
x[n]\,
e^{-j 2\pi kn/N}
\]

where:

- \(k\) is the frequency-bin index;
- \(j = \sqrt{-1}\);
- \(X[k]\) is a complex value containing amplitude and phase.

A fast Fourier transform is an efficient algorithm for computing the same DFT.
It does not change the mathematical result.

For real-valued audio, the positive-frequency spectrum contains:

\[
\frac{N}{2}
\]

bins in Web Audio's `AnalyserNode.frequencyBinCount`.

For:

\[
N = 2048
\]

Web Audio exposes:

\[
\text{frequencyBinCount} = 1024
\]

positive-frequency bins.

---

## 3. Frequency resolution

The spacing between adjacent FFT bins is:

\[
\Delta f = \frac{f_s}{N}
\]

where:

- \(\Delta f\) is frequency resolution in hertz per bin;
- \(f_s\) is the sample rate;
- \(N\) is the FFT size.

For \(f_s = 48{,}000\) Hz and \(N = 2048\):

\[
\Delta f =
\frac{48000}{2048}
= 23.4375\ \text{Hz/bin}
\]

The center frequency represented by bin \(k\) is:

\[
f_k = k\Delta f
= k\frac{f_s}{N}
\]

Examples:

| Bin \(k\) | Frequency at 48 kHz and FFT 2048 |
| --------: | -------------------------------: |
|         0 |                             0 Hz |
|         1 |                       23.4375 Hz |
|        10 |                       234.375 Hz |
|        43 |                     1007.8125 Hz |
|       100 |                       2343.75 Hz |
|       512 |                        12,000 Hz |
|      1023 |                   23,976.5625 Hz |

The Nyquist frequency is:

\[
f_{\text{Nyquist}} = \frac{f_s}{2}
\]

For a 48 kHz context:

\[
f_{\text{Nyquist}} = 24{,}000\ \text{Hz}
\]

### TypeScript helpers

```ts
export function frequencyResolution(
  sampleRate: number,
  fftSize: number,
): number {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError("sampleRate must be positive");
  }

  if (!Number.isInteger(fftSize) || fftSize <= 0) {
    throw new RangeError("fftSize must be a positive integer");
  }

  return sampleRate / fftSize;
}

export function frequencyForBin(
  binIndex: number,
  sampleRate: number,
  fftSize: number,
): number {
  return binIndex * frequencyResolution(sampleRate, fftSize);
}

export function binForFrequency(
  frequencyHz: number,
  sampleRate: number,
  fftSize: number,
): number {
  const maxBin = fftSize / 2 - 1;
  const rawBin = Math.round(
    frequencyHz / frequencyResolution(sampleRate, fftSize),
  );

  return Math.max(0, Math.min(maxBin, rawBin));
}
```

Usage:

```ts
const resolution = frequencyResolution(
  audioContext.sampleRate,
  analyser.fftSize,
);

const oneKilohertzBin = binForFrequency(
  1000,
  audioContext.sampleRate,
  analyser.fftSize,
);
```

---

## 4. Why window functions are needed

The FFT assumes the observed frame repeats periodically.

When the beginning and end of the frame do not meet smoothly, the repeated
signal contains a discontinuity. That discontinuity spreads energy into nearby
frequency bins. This effect is called spectral leakage.

Before the FFT, multiply each sample by a window:

\[
x_w[n] = x[n]w[n]
\]

where:

- \(x[n]\) is the original sample;
- \(w[n]\) is the window coefficient;
- \(x_w[n]\) is the windowed sample.

A window reduces boundary discontinuities but introduces trade-offs:

- main-lobe width controls how closely spaced tones can be distinguished;
- side-lobe level controls leakage from strong frequencies into weak ones;
- coherent gain changes measured amplitude;
- equivalent noise bandwidth affects noise-floor measurements.

No window is best for every use case.

---

## 5. Hann window

The issue calls this a "Hanning" window. The mathematically established name is
the **Hann window**; "Hanning" is a commonly used informal variant.

For \(N\) samples:

\[
w_{\text{Hann}}[n]
=

\frac{1}{2}
\left(
1 -
\cos
\left(
\frac{2\pi n}{N-1}
\right)
\right)
\]

for:

\[
0 \le n \le N-1
\]

Equivalent form:

\[
w_{\text{Hann}}[n]
=

0.5 -
0.5
\cos
\left(
\frac{2\pi n}{N-1}
\right)
\]

Properties:

- both endpoints approach zero;
- substantially reduces leakage compared with a rectangular window;
- offers a useful balance between frequency resolution and leakage;
- is a common default for real-time audio visualizations.

### TypeScript implementation

```ts
export function createHannWindow(size: number): Float32Array {
  if (!Number.isInteger(size) || size < 2) {
    throw new RangeError("Window size must be an integer >= 2");
  }

  const window = new Float32Array(size);

  for (let n = 0; n < size; n += 1) {
    window[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (size - 1));
  }

  return window;
}
```

Apply it:

```ts
export function applyWindow(
  samples: Float32Array,
  window: Float32Array,
): Float32Array {
  if (samples.length !== window.length) {
    throw new RangeError("Samples and window must have equal lengths");
  }

  const output = new Float32Array(samples.length);

  for (let n = 0; n < samples.length; n += 1) {
    output[n] = samples[n] * window[n];
  }

  return output;
}
```

### Hann coherent gain

A window attenuates a tone's measured amplitude.

Coherent gain is:

\[
G_c =
\frac{1}{N}
\sum_{n=0}^{N-1}
w[n]
\]

For a Hann window, it approaches:

\[
G_c \approx 0.5
\]

When accurate amplitude measurement is required, compensate approximately by:

\[
A_{\text{corrected}}
=

\frac{A_{\text{measured}}}{G_c}
\]

A visualization does not always need coherent-gain compensation, provided its
display scale is intentionally calibrated.

---

## 6. Four-term Blackman–Harris window

A common four-term Blackman–Harris window is:

\[
w_{\text{BH}}[n]
=

a_0
-

a_1\cos(\theta_n) +
a_2\cos(2\theta_n)
-

a_3\cos(3\theta_n)
\]

where:

\[
\theta_n =
\frac{2\pi n}{N-1}
\]

and the standard coefficients are:

\[
a_0 = 0.35875
\]

\[
a_1 = 0.48829
\]

\[
a_2 = 0.14128
\]

\[
a_3 = 0.01168
\]

Therefore:

\[
\begin{aligned}
w_{\text{BH}}[n]
={}&
0.35875
-

0.48829\cos(\theta_n)
\\
&+
0.14128\cos(2\theta_n)
-

0.01168\cos(3\theta_n)
\end{aligned}
\]

Properties:

- much lower side lobes than Hann;
- better at revealing weak signals near a strong tone;
- wider main lobe;
- lower effective frequency separation;
- greater amplitude attenuation.

### TypeScript implementation

```ts
export function createBlackmanHarrisWindow(size: number): Float32Array {
  if (!Number.isInteger(size) || size < 2) {
    throw new RangeError("Window size must be an integer >= 2");
  }

  const a0 = 0.35875;
  const a1 = 0.48829;
  const a2 = 0.14128;
  const a3 = 0.01168;

  const window = new Float32Array(size);

  for (let n = 0; n < size; n += 1) {
    const theta = (2 * Math.PI * n) / (size - 1);

    window[n] =
      a0 -
      a1 * Math.cos(theta) +
      a2 * Math.cos(2 * theta) -
      a3 * Math.cos(3 * theta);
  }

  return window;
}
```

### Choosing between Hann and Blackman–Harris

| Requirement                           | Suggested window                           |
| ------------------------------------- | ------------------------------------------ |
| General live spectrum or spectrogram  | Hann                                       |
| Balanced time and frequency response  | Hann                                       |
| Detect weak tones beside strong tones | Blackman–Harris                            |
| Lowest practical side-lobe leakage    | Blackman–Harris                            |
| Separate two nearby frequencies       | Hann may preserve more apparent separation |
| Accurate amplitude measurement        | Either, with coherent-gain correction      |

For WorkSphere's live environmental-noise visualization, Hann is normally the
simpler default. Blackman–Harris is useful when leakage suppression matters
more than narrow frequency discrimination.

---

## 7. Web Audio `AnalyserNode` behavior

Create and configure an analyser:

```ts
const analyser = audioContext.createAnalyser();

analyser.fftSize = 2048;
analyser.minDecibels = -100;
analyser.maxDecibels = -10;
analyser.smoothingTimeConstant = 0.8;
```

Read floating-point spectrum data:

```ts
const bins = new Float32Array(analyser.frequencyBinCount);

analyser.getFloatFrequencyData(bins);
```

Each value represents a frequency-bin magnitude in decibels, generally dBFS.

Important:

```text
bins.length === analyser.frequencyBinCount
bins.length === analyser.fftSize / 2
```

With an FFT size of 2048:

```text
bins.length === 1024
```

### Decibels and amplitude

For an amplitude ratio:

\[
L_{\text{dB}}
=

20\log_{10}
\left(
\frac{A}{A_{\text{ref}}}
\right)
\]

Recover the amplitude ratio:

\[
\frac{A}{A_{\text{ref}}}
=

10^{L_{\text{dB}}/20}
\]

For a power ratio:

\[
L_{\text{dB}}
=

10\log_{10}
\left(
\frac{P}{P_{\text{ref}}}
\right)
\]

Web Audio spectrum values are already expressed in decibels. A renderer
normally maps those values into a chosen display interval instead of converting
them back to linear amplitude.

### dBFS is not sound-pressure level

`getFloatFrequencyData()` does not directly provide calibrated acoustic dB SPL.

It provides a digital level relative to full scale. WorkSphere may map this to a
friendlier display scale, but that mapping is approximate unless microphone,
device gain, and acoustic reference pressure are calibrated.

Do not label uncalibrated dBFS values as laboratory-accurate dB SPL.

---

## 8. Normalizing decibel values

WorkSphere uses this linear normalization:

\[
t =
\operatorname{clamp}
\left(
\frac{dB - dB_{\min}}
{dB_{\max} - dB_{\min}},
0,
1
\right)
\]

where:

- \(dB\) is the raw bin value;
- \(dB_{\min}\) is the visible floor;
- \(dB_{\max}\) is the visible ceiling;
- \(t\) is normalized intensity.

Repository implementation:

```ts
export function normalizeBinDb(
  dbfs: number,
  minDb = -100,
  maxDb = -10,
): number {
  if (!Number.isFinite(dbfs)) {
    return 0;
  }

  return Math.min(1, Math.max(0, (dbfs - minDb) / (maxDb - minDb)));
}
```

Examples using \(-100\) to \(-10\) dB:

| Raw value | Normalized intensity |
| --------: | -------------------: |
|   -100 dB |                    0 |
|  -77.5 dB |                 0.25 |
|    -55 dB |                  0.5 |
|  -32.5 dB |                 0.75 |
|    -10 dB |                    1 |

### Defensive version

```ts
export function normalizeDecibels(
  db: number,
  minDb: number,
  maxDb: number,
): number {
  if (
    !Number.isFinite(db) ||
    !Number.isFinite(minDb) ||
    !Number.isFinite(maxDb) ||
    maxDb <= minDb
  ) {
    return 0;
  }

  return Math.max(0, Math.min(1, (db - minDb) / (maxDb - minDb)));
}
```

---

## 9. Converting decibels to canvas bar heights

For a canvas plot height \(H\):

\[
h = tH
\]

where:

- \(t\) is normalized intensity;
- \(h\) is bar height in pixels.

Canvas coordinates increase downward, so the bar's top coordinate is:

\[
y = H - h
\]

### TypeScript helper

```ts
export function decibelsToBarHeight(
  db: number,
  canvasHeight: number,
  minDb = -100,
  maxDb = -10,
): number {
  if (!Number.isFinite(canvasHeight) || canvasHeight <= 0) {
    return 0;
  }

  const intensity = normalizeDecibels(db, minDb, maxDb);

  return intensity * canvasHeight;
}
```

### Drawing spectrum bars

```ts
export function drawSpectrumBars(input: {
  context: CanvasRenderingContext2D;
  bins: Float32Array;
  width: number;
  height: number;
  minDb?: number;
  maxDb?: number;
}) {
  const { context, bins, width, height, minDb = -100, maxDb = -10 } = input;

  context.clearRect(0, 0, width, height);

  if (bins.length === 0) {
    return;
  }

  const barWidth = width / bins.length;

  for (let index = 0; index < bins.length; index += 1) {
    const barHeight = decibelsToBarHeight(bins[index], height, minDb, maxDb);

    const x = index * barWidth;
    const y = height - barHeight;

    context.fillRect(x, y, Math.max(1, barWidth), barHeight);
  }
}
```

### Numerical example

Given:

```text
raw bin = -55 dB
minimum = -100 dB
maximum = -10 dB
canvas height = 240 px
```

Normalize:

\[
t =
\frac{-55 - (-100)}
{-10 - (-100)}
=

\frac{45}{90}
=

0.5
\]

Height:

\[
h = 0.5 \times 240 = 120\ \text{px}
\]

Top position:

\[
y = 240 - 120 = 120\ \text{px}
\]

---

## 10. Nonlinear visual scaling

A linear mapping in decibel space is already perceptually useful because
decibels are logarithmic.

Additional contrast curves may improve visibility.

### Gamma curve

\[
t_{\gamma} = t^\gamma
\]

- \(\gamma < 1\) brightens quiet values;
- \(\gamma > 1\) emphasizes strong values.

```ts
export function applyIntensityGamma(intensity: number, gamma = 0.7): number {
  const clamped = Math.max(0, Math.min(1, intensity));

  return clamped ** gamma;
}
```

Use carefully. The color legend and interpretation must match the applied
curve.

---

## 11. Spectrogram rendering

A spectrogram typically maps:

- horizontal axis: time;
- vertical axis: frequency;
- color: spectral magnitude.

Two common orientations are:

```text
new time enters from the right
frequency increases upward
```

or:

```text
new time enters from the bottom
frequency increases horizontally
```

WorkSphere's color helper maps normalized intensity to a cold-to-hot RGB value:

```ts
spectrogramColor(t);
```

### Shift-left waterfall

```ts
export function drawSpectrogramColumn(input: {
  context: CanvasRenderingContext2D;
  bins: Float32Array;
  width: number;
  height: number;
  minDb?: number;
  maxDb?: number;
  colorForIntensity: (intensity: number) => [number, number, number];
}) {
  const {
    context,
    bins,
    width,
    height,
    minDb = -100,
    maxDb = -10,
    colorForIntensity,
  } = input;

  if (bins.length === 0 || width <= 0 || height <= 0) {
    return;
  }

  context.drawImage(
    context.canvas,
    1,
    0,
    width - 1,
    height,
    0,
    0,
    width - 1,
    height,
  );

  const image = context.createImageData(1, height);

  for (let y = 0; y < height; y += 1) {
    const frequencyRatio = 1 - y / Math.max(1, height - 1);

    const binIndex = Math.min(
      bins.length - 1,
      Math.floor(frequencyRatio * bins.length),
    );

    const intensity = normalizeDecibels(bins[binIndex], minDb, maxDb);

    const [red, green, blue] = colorForIntensity(intensity);

    const offset = y * 4;

    image.data[offset] = red;
    image.data[offset + 1] = green;
    image.data[offset + 2] = blue;
    image.data[offset + 3] = 255;
  }

  context.putImageData(image, width - 1, 0);
}
```

This places low frequencies near the bottom and high frequencies near the top.

---

## 12. Mapping a pixel row to frequency

For a linear frequency axis with zero hertz at the bottom:

\[
r =
1 -
\frac{y}{H-1}
\]

\[
f(y) =
r\frac{f_s}{2}
\]

where:

- \(y = 0\) is the top;
- \(H\) is canvas height;
- \(r\) is normalized frequency;
- \(f_s/2\) is Nyquist frequency.

Helper:

```ts
export function frequencyForCanvasY(
  y: number,
  canvasHeight: number,
  sampleRate: number,
): number {
  if (canvasHeight <= 1) {
    return 0;
  }

  const ratio = 1 - Math.max(0, Math.min(1, y / (canvasHeight - 1)));

  return ratio * (sampleRate / 2);
}
```

---

## 13. Logarithmic frequency axes

Human hearing and musical pitch are often clearer on a logarithmic axis.

For visible frequency limits:

\[
f_{\min} > 0
\]

\[
f_{\max} \le \frac{f_s}{2}
\]

map a vertical ratio \(r\) to frequency:

\[
f(r)
=

f_{\min}
\left(
\frac{f_{\max}}{f_{\min}}
\right)^r
\]

where \(0 \le r \le 1\).

TypeScript:

```ts
export function logarithmicFrequency(
  ratio: number,
  minFrequency: number,
  maxFrequency: number,
): number {
  const normalized = Math.max(0, Math.min(1, ratio));

  return minFrequency * (maxFrequency / minFrequency) ** normalized;
}
```

Convert frequency to a fractional bin:

\[
k =
\frac{fN}{f_s}
\]

```ts
export function fractionalBinForFrequency(
  frequency: number,
  sampleRate: number,
  fftSize: number,
): number {
  return (frequency * fftSize) / sampleRate;
}
```

Use interpolation between adjacent bins for smoother results:

```ts
export function interpolateBin(
  bins: Float32Array,
  fractionalIndex: number,
): number {
  if (bins.length === 0) {
    return -Infinity;
  }

  const bounded = Math.max(0, Math.min(bins.length - 1, fractionalIndex));

  const lower = Math.floor(bounded);
  const upper = Math.min(bins.length - 1, lower + 1);
  const fraction = bounded - lower;

  return bins[lower] * (1 - fraction) + bins[upper] * fraction;
}
```

A logarithmic display must not begin at 0 Hz because the logarithm of zero is
undefined. A practical lower bound is commonly 20 Hz.

---

## 14. Canvas width and bin aggregation

A 1024-bin spectrum may be drawn on a canvas narrower than 1024 pixels.

Do not blindly draw 1024 overlapping one-pixel bars. Aggregate bins into pixel
columns.

For a canvas width \(W\), the bin interval for column \(x\) is approximately:

\[
k_{\text{start}}
=

\left\lfloor
\frac{xB}{W}
\right\rfloor
\]

\[
k_{\text{end}}
=

\left\lfloor
\frac{(x+1)B}{W}
\right\rfloor
\]

where \(B\) is the number of frequency bins.

```ts
export function aggregateBinsByPixel(
  bins: Float32Array,
  pixelWidth: number,
): Float32Array {
  if (pixelWidth <= 0) {
    return new Float32Array();
  }

  const output = new Float32Array(pixelWidth);

  for (let x = 0; x < pixelWidth; x += 1) {
    const start = Math.floor((x * bins.length) / pixelWidth);

    const end = Math.max(
      start + 1,
      Math.floor(((x + 1) * bins.length) / pixelWidth),
    );

    let peak = -Infinity;

    for (let index = start; index < Math.min(end, bins.length); index += 1) {
      peak = Math.max(peak, bins[index]);
    }

    output[x] = Number.isFinite(peak) ? peak : -Infinity;
  }

  return output;
}
```

Peak aggregation preserves narrow spectral components. Mean or RMS aggregation
may produce a smoother noise-density display.

---

## 15. High-DPI canvas handling

CSS pixels and device pixels differ on high-density displays.

```ts
export function resizeCanvasForDisplay(canvas: HTMLCanvasElement): {
  width: number;
  height: number;
} {
  const bounds = canvas.getBoundingClientRect();

  const ratio = window.devicePixelRatio || 1;

  const width = Math.max(1, Math.round(bounds.width * ratio));

  const height = Math.max(1, Math.round(bounds.height * ratio));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  return {
    width,
    height,
  };
}
```

Use the actual backing-store dimensions for pixel rendering.

---

## 16. Temporal smoothing

Web Audio provides:

```ts
analyser.smoothingTimeConstant;
```

Its range is:

```text
0 to 1
```

Conceptually, smoothed spectrum data follows an exponential relationship:

\[
S_t[k]
=

\alpha S_{t-1}[k] +
(1-\alpha)X_t[k]
\]

where:

- \(X_t[k]\) is the current spectral value;
- \(S_t[k]\) is the smoothed value;
- \(\alpha\) is the smoothing coefficient.

Higher values:

- make the display steadier;
- retain peaks longer;
- respond more slowly.

Lower values:

- respond quickly;
- appear more animated;
- may flicker.

Suggested visualization starting point:

```ts
analyser.smoothingTimeConstant = 0.8;
```

Tune using actual UI behavior.

---

## 17. Frame rate and analysis overlap

WorkSphere currently defines:

```ts
export const TARGET_FPS = 60;
export const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;
```

At 60 frames per second:

\[
\text{frame interval}
=

\frac{1000}{60}
\approx
16.67\ \text{ms}
\]

With a 2048-point FFT at 48 kHz, the FFT window covers approximately 42.67 ms.
Successive display frames therefore contain overlapping analysis history.

This is normal. Display frame rate and FFT time-span are independent settings.

A rendering loop should prevent duplicate work:

```ts
let previousTime = 0;

function render(now: number) {
  requestAnimationFrame(render);

  if (now - previousTime < FRAME_INTERVAL_MS) {
    return;
  }

  previousTime = now;

  analyser.getFloatFrequencyData(bins);
  drawFrame(bins);
}

requestAnimationFrame(render);
```

---

## 18. Color normalization

WorkSphere uses:

```ts
spectrogramColor(intensity);
```

with normalized intensity:

\[
0 \le t \le 1
\]

Interpretation:

```text
0 → cold / weak
1 → hot / strong
```

Color should encode the same normalized range used by the legend.

Example:

```ts
const intensity = normalizeBinDb(
  bins[index],
  analyser.minDecibels,
  analyser.maxDecibels,
);

const [red, green, blue] = spectrogramColor(intensity);

context.fillStyle = `rgb(${red} ${green} ${blue})`;
```

Do not use raw negative decibel values directly as RGB components.

---

## 19. Numerical edge cases

### `-Infinity`

An analyser may return `-Infinity` for bins with no measurable energy.

Map it to zero intensity:

```ts
if (!Number.isFinite(db)) {
  return 0;
}
```

### Invalid decibel bounds

Require:

\[
dB_{\max} > dB_{\min}
\]

Otherwise normalization divides by zero or reverses the scale.

### Empty bin arrays

Return without rendering or draw a cleared state.

### Zero-size canvas

Do not divide by canvas dimensions unless they are positive.

### Clamping

Clamp intensity:

\[
0 \le t \le 1
\]

to prevent invalid pixel heights and colors.

---

## 20. Complete spectrum renderer

```ts
import { normalizeBinDb, spectrogramColor } from "@/lib/noise/fftSpectrogram";

type SpectrumRendererOptions = {
  analyser: AnalyserNode;
  canvas: HTMLCanvasElement;
};

export function createSpectrumRenderer(options: SpectrumRendererOptions) {
  const { analyser, canvas } = options;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("2D canvas context unavailable");
  }

  const bins = new Float32Array(analyser.frequencyBinCount);

  let animationFrame = 0;
  let stopped = false;

  function draw() {
    if (stopped) {
      return;
    }

    animationFrame = requestAnimationFrame(draw);

    analyser.getFloatFrequencyData(bins);

    const width = canvas.width;
    const height = canvas.height;

    context.clearRect(0, 0, width, height);

    const visibleBins = aggregateBinsByPixel(bins, Math.max(1, width));

    for (let x = 0; x < visibleBins.length; x += 1) {
      const intensity = normalizeBinDb(
        visibleBins[x],
        analyser.minDecibels,
        analyser.maxDecibels,
      );

      const barHeight = intensity * height;

      const [red, green, blue] = spectrogramColor(intensity);

      context.fillStyle = `rgb(${red} ${green} ${blue})`;

      context.fillRect(x, height - barHeight, 1, barHeight);
    }
  }

  draw();

  return () => {
    stopped = true;
    cancelAnimationFrame(animationFrame);
  };
}
```

---

## 21. Testing the mathematics

Recommended unit tests:

```ts
describe("FFT mathematical helpers", () => {
  it("calculates frequency resolution", () => {
    expect(frequencyResolution(48_000, 2048)).toBeCloseTo(23.4375, 6);
  });

  it("maps a 1 kHz tone near bin 43", () => {
    expect(binForFrequency(1000, 48_000, 2048)).toBe(43);
  });

  it("maps the decibel midpoint to half height", () => {
    expect(decibelsToBarHeight(-55, 240, -100, -10)).toBeCloseTo(120, 6);
  });

  it("creates Hann endpoints near zero", () => {
    const window = createHannWindow(2048);

    expect(window[0]).toBeCloseTo(0, 6);

    expect(window[window.length - 1]).toBeCloseTo(0, 6);
  });

  it("creates Blackman-Harris endpoints near zero", () => {
    const window = createBlackmanHarrisWindow(2048);

    expect(window[0]).toBeCloseTo(0.00006, 5);

    expect(window[window.length - 1]).toBeCloseTo(0.00006, 5);
  });
});
```

### Visual test signals

Test with:

- a single 1 kHz sine wave;
- two closely spaced tones;
- a strong tone beside a weak tone;
- white noise;
- pink noise;
- silence;
- an impulse;
- live microphone speech.

Expected 1 kHz location at 48 kHz and FFT 2048:

\[
k =
\frac{1000 \times 2048}{48000}
\approx 42.67
\]

Therefore the peak should appear near bin 43.

---

## 22. Common mistakes

### Using `frequencyBinCount` as the FFT size

Incorrect:

```ts
const resolution = sampleRate / analyser.frequencyBinCount;
```

Correct:

```ts
const resolution = sampleRate / analyser.fftSize;
```

`frequencyBinCount` is half the FFT size.

### Treating dBFS as calibrated dB SPL

A browser analyser is not an acoustic sound-level meter without calibration.

### Forgetting the inverted canvas Y axis

Correct:

```ts
const y = canvas.height - barHeight;
```

### Rendering more bars than pixels

Aggregate bins when the canvas is narrower than the spectrum.

### Applying a second window to `AnalyserNode` output

`getFloatFrequencyData()` already returns analysed frequency data. Window
functions apply to time-domain samples before FFT computation. Do not multiply
frequency bins by a time-domain window.

### Inventing FFT latency from frame rate

FFT window duration is:

\[
N/f_s
\]

not:

\[
1/\text{display FPS}
\]

### Ignoring device-pixel ratio

A canvas that is not resized for its backing resolution may appear blurry.

---

## 23. Recommended WorkSphere defaults

```ts
analyser.fftSize = 2048;
analyser.minDecibels = -100;
analyser.maxDecibels = -10;
analyser.smoothingTimeConstant = 0.8;
```

For a 48 kHz device:

```text
Frequency resolution: 23.4375 Hz/bin
Positive-frequency bins: 1024
Nyquist frequency: 24 kHz
FFT time span: 42.67 ms
```

Recommended visualization choices:

| Concern                       | Recommendation                   |
| ----------------------------- | -------------------------------- |
| Window for custom FFT         | Hann                             |
| Leakage-sensitive diagnostics | Four-term Blackman–Harris        |
| Raw spectrum source           | `getFloatFrequencyData()`        |
| Decibel normalization         | Clamp linearly in dB space       |
| Bar height                    | `normalized × canvasHeight`      |
| Bar top                       | `canvasHeight - barHeight`       |
| Spectrogram color             | `spectrogramColor(normalized)`   |
| Narrow canvases               | Aggregate bins by pixel          |
| Frequency labels              | Use `bin × sampleRate / fftSize` |
| High-DPI display              | Resize backing canvas            |
| Uncalibrated input            | Label as relative/digital level  |

---

## 24. Review checklist

### Mathematics

- [ ] Frequency resolution uses `sampleRate / fftSize`.
- [ ] Bin frequency uses `binIndex * sampleRate / fftSize`.
- [ ] Positive-frequency bin count uses `fftSize / 2`.
- [ ] Nyquist frequency uses `sampleRate / 2`.
- [ ] Window equations use `N - 1` consistently.
- [ ] Windowing occurs before a custom FFT.
- [ ] Decibel values are normalized with valid bounds.

### Rendering

- [ ] Canvas height is positive.
- [ ] Non-finite bins map safely to zero intensity.
- [ ] Pixel heights are clamped.
- [ ] Canvas Y inversion is handled.
- [ ] High-DPI backing resolution is configured.
- [ ] Bins are aggregated when necessary.
- [ ] Color and height use the same intensity scale.

### Interpretation

- [ ] dBFS is not presented as calibrated dB SPL.
- [ ] FFT resolution is distinguished from visual frame rate.
- [ ] Window trade-offs are explained.
- [ ] Amplitude correction is applied only when required.
- [ ] Logarithmic axes avoid zero frequency.

---

## 25. Summary

For a Web Audio analyser:

\[
\Delta f =
\frac{f_s}{N}
\]

\[
f_k =
k\frac{f_s}{N}
\]

For decibel rendering:

\[
t =
\operatorname{clamp}
\left(
\frac{dB-dB_{\min}}
{dB_{\max}-dB_{\min}},
0,
1
\right)
\]

\[
h = tH
\]

\[
y = H-h
\]

Use the Hann window for a balanced general-purpose custom FFT and the
four-term Blackman–Harris window when strong leakage suppression is more
important than narrow main-lobe width.
