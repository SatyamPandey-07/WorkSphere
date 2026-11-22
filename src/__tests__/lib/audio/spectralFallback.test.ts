import {
  ANALYSER_FFT_SIZE,
  ANALYSER_TO_WORKLET_SCALE,
  WASM_SIMD_PROBE_BYTES,
  buildSpectralFrame,
  detectWasmSimd,
} from "@/lib/audio/spectralFallback";

const SAMPLE_RATE = 48000;
const N = ANALYSER_FFT_SIZE;
const HALF = N / 2;

/** Sine of amplitude `amp` centred exactly on FFT bin `bin`. */
function sine(amp: number, bin: number): Float32Array {
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = amp * Math.sin((2 * Math.PI * bin * i) / N);
  return out;
}

/** Magnitude spectrum |X[k]| of `signal` after applying `window`. */
function windowedMagnitudes(signal: Float32Array, window: Float32Array) {
  const mags = new Float32Array(HALF);
  for (let k = 0; k < HALF; k++) {
    let re = 0;
    let im = 0;
    for (let n = 0; n < N; n++) {
      const v = signal[n] * window[n];
      re += v * Math.cos((2 * Math.PI * k * n) / N);
      im -= v * Math.sin((2 * Math.PI * k * n) / N);
    }
    mags[k] = Math.sqrt(re * re + im * im);
  }
  return mags;
}

const hann = Float32Array.from(
  { length: N },
  (_, i) => 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1))),
);
const blackman = Float32Array.from({ length: N }, (_, i) => {
  const a = 0.16;
  const x = (2 * Math.PI * i) / (N - 1);
  return (1 - a) / 2 - 0.5 * Math.cos(x) + (a / 2) * Math.cos(2 * x);
});

/** What AnalyserNode.getFloatFrequencyData reports: 20*log10(|X|/N), Blackman. */
function analyserDb(signal: Float32Array): Float32Array {
  const mags = windowedMagnitudes(signal, blackman);
  return Float32Array.from(mags, (m) => 20 * Math.log10(m / N));
}

describe("detectWasmSimd (#8629)", () => {
  const realValidate = WebAssembly.validate;

  afterEach(() => {
    WebAssembly.validate = realValidate;
  });

  it("probes with a module that actually contains SIMD opcodes", () => {
    // 0xfd is the SIMD opcode prefix.
    expect(Array.from(WASM_SIMD_PROBE_BYTES)).toContain(253);
  });

  it("reports support when the engine validates the SIMD probe", () => {
    const validate = jest.fn().mockReturnValue(true);
    WebAssembly.validate = validate;

    expect(detectWasmSimd()).toBe(true);
    expect(validate).toHaveBeenCalledWith(WASM_SIMD_PROBE_BYTES);
  });

  it("reports no support when the engine rejects the SIMD probe", () => {
    WebAssembly.validate = jest.fn().mockReturnValue(false);

    expect(detectWasmSimd()).toBe(false);
  });

  it("reports no support when validate throws", () => {
    WebAssembly.validate = jest.fn(() => {
      throw new Error("unsupported");
    });

    expect(detectWasmSimd()).toBe(false);
  });

  it("reports no support when WebAssembly is missing entirely", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "WebAssembly");
    // @ts-expect-error simulating an engine without WebAssembly
    delete globalThis.WebAssembly;

    try {
      expect(detectWasmSimd()).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "WebAssembly", original!);
    }
  });

  it("agrees with the real engine in this runtime", () => {
    expect(detectWasmSimd()).toBe(realValidate(WASM_SIMD_PROBE_BYTES));
  });
});

describe("buildSpectralFrame (#8629)", () => {
  it("produces the same shape as the worklet frame", () => {
    const signal = sine(0.5, 32);
    const frame = buildSpectralFrame(analyserDb(signal), signal, SAMPLE_RATE);

    expect(frame.bins).toBeInstanceOf(Float32Array);
    expect(frame.bins).toHaveLength(HALF);
    expect(typeof frame.splDb).toBe("number");
    expect(typeof frame.dominantFrequencyHz).toBe("number");
    expect(typeof frame.latencyMs).toBe("number");
  });

  it("finds the dominant frequency like the worklet", () => {
    const bin = 40;
    const signal = sine(0.4, bin);
    const frame = buildSpectralFrame(analyserDb(signal), signal, SAMPLE_RATE);

    expect(frame.dominantFrequencyHz).toBeCloseTo((bin * SAMPLE_RATE) / N, 5);
  });

  it("matches the worklet's bin scale (2/N, Hann) within a few percent", () => {
    const amp = 0.5;
    const bin = 32;
    const signal = sine(amp, bin);

    const frame = buildSpectralFrame(analyserDb(signal), signal, SAMPLE_RATE);

    // Reference: exactly what the worklet computes, |X| * 2/N with a Hann window.
    const workletBins = windowedMagnitudes(signal, hann).map((m) => (m * 2) / N);

    expect(workletBins[bin]).toBeGreaterThan(0.2);
    expect(frame.bins[bin] / workletBins[bin]).toBeGreaterThan(0.95);
    expect(frame.bins[bin] / workletBins[bin]).toBeLessThan(1.05);
  });

  it("keeps the scale factor consistent with the two window gains", () => {
    expect(ANALYSER_TO_WORKLET_SCALE).toBeCloseTo(1 / 0.42, 6);
  });

  it("computes SPL from RMS with the worklet's mapping and clamp", () => {
    const signal = sine(0.5, 16);
    const rms = 0.5 / Math.SQRT2;
    const expected = 20 * Math.log10(rms) + 100;

    const frame = buildSpectralFrame(analyserDb(signal), signal, SAMPLE_RATE);

    expect(frame.splDb).toBeCloseTo(expected, 5);
  });

  it("reports the 20 dB floor and zero frequency for silence", () => {
    const silenceDb = new Float32Array(HALF).fill(-Infinity);
    const silence = new Float32Array(N);

    const frame = buildSpectralFrame(silenceDb, silence, SAMPLE_RATE);

    expect(frame.splDb).toBe(20);
    expect(frame.dominantFrequencyHz).toBe(0);
    expect(Array.from(frame.bins).every((b) => b === 0)).toBe(true);
  });

  it("clamps SPL at 120 dB for full-scale input", () => {
    const loud = new Float32Array(N).fill(1000);

    const frame = buildSpectralFrame(new Float32Array(HALF).fill(-30), loud, SAMPLE_RATE);

    expect(frame.splDb).toBe(120);
  });

  it("ignores the DC bin when picking the dominant frequency", () => {
    const db = new Float32Array(HALF).fill(-120);
    db[0] = 0; // huge DC offset
    db[10] = -20;

    const frame = buildSpectralFrame(db, new Float32Array(N), SAMPLE_RATE);

    expect(frame.dominantFrequencyHz).toBeCloseTo((10 * SAMPLE_RATE) / N, 5);
  });

  it("treats NaN and -Infinity bins as zero energy", () => {
    const db = new Float32Array(HALF).fill(NaN);
    db[3] = -Infinity;

    const frame = buildSpectralFrame(db, new Float32Array(N), SAMPLE_RATE);

    expect(Array.from(frame.bins).every((b) => b === 0)).toBe(true);
  });
});
