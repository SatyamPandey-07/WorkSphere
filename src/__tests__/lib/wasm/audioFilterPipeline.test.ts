/**
 * @jest-environment node
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  AudioFilterPipeline,
  biquadMagnitudeDb,
  designBiquad,
  isWasmSimdSupported,
  loadAudioFilterPipeline,
  type BiquadCoefficients,
  type BiquadStageConfig,
} from "@/lib/wasm/audioFilterPipeline";

const SAMPLE_RATE = 48000;
const RENDER_QUANTUM = 128;

const simdBinary = readFileSync(
  join(process.cwd(), "public/audio-filter-simd.wasm"),
);
const scalarBinary = readFileSync(
  join(process.cwd(), "public/audio-filter-scalar.wasm"),
);

/** Plain-JS TDF-II reference using float32 rounding to mirror the WASM math. */
function referenceFilter(
  channels: Float32Array[],
  coefficients: BiquadCoefficients[],
): Float32Array[] {
  const f = Math.fround;
  return channels.map((input) => {
    const out = Float32Array.from(input);
    for (const c of coefficients) {
      const [b0, b1, b2, a1, a2] = [c.b0, c.b1, c.b2, c.a1, c.a2].map(f);
      let z1 = 0;
      let z2 = 0;
      for (let t = 0; t < out.length; t++) {
        const x = out[t];
        const y = f(f(b0 * x) + z1);
        z1 = f(f(f(b1 * x) - f(a1 * y)) + z2);
        z2 = f(f(b2 * x) - f(a2 * y));
        out[t] = y;
      }
    }
    return out;
  });
}

function sine(frequency: number, frames: number, amplitude = 0.5): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE);
  }
  return out;
}

/** Deterministic noise in [-0.5, 0.5) so failures are reproducible. */
function noise(frames: number, seed: number): Float32Array {
  let s = seed >>> 0;
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = s / 4294967296 - 0.5;
  }
  return out;
}

function rms(buf: Float32Array, from = 0): number {
  let sum = 0;
  for (let i = from; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / (buf.length - from));
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]));
  return max;
}

const CHAIN: BiquadStageConfig[] = [
  { type: "highpass", frequency: 80 },
  { type: "peaking", frequency: 1000, q: 1.2, gainDb: 4 },
  { type: "lowshelf", frequency: 200, gainDb: -3 },
  { type: "lowpass", frequency: 8000 },
];

describe("designBiquad", () => {
  it("lowpass passes DC and attenuates far above the cutoff", () => {
    const c = designBiquad({ type: "lowpass", frequency: 1000 }, SAMPLE_RATE);
    expect(biquadMagnitudeDb(c, 10, SAMPLE_RATE)).toBeCloseTo(0, 2);
    expect(biquadMagnitudeDb(c, 1000, SAMPLE_RATE)).toBeCloseTo(-3.01, 1);
    expect(biquadMagnitudeDb(c, 10000, SAMPLE_RATE)).toBeLessThan(-30);
  });

  it("highpass blocks low frequencies and passes high ones", () => {
    const c = designBiquad({ type: "highpass", frequency: 500 }, SAMPLE_RATE);
    expect(biquadMagnitudeDb(c, 20, SAMPLE_RATE)).toBeLessThan(-40);
    expect(biquadMagnitudeDb(c, 15000, SAMPLE_RATE)).toBeCloseTo(0, 1);
  });

  it("peaking hits the requested gain at the centre frequency", () => {
    const c = designBiquad(
      { type: "peaking", frequency: 2000, q: 2, gainDb: 6 },
      SAMPLE_RATE,
    );
    expect(biquadMagnitudeDb(c, 2000, SAMPLE_RATE)).toBeCloseTo(6, 3);
    expect(biquadMagnitudeDb(c, 50, SAMPLE_RATE)).toBeCloseTo(0, 1);
  });

  it("shelves reach their gain on the shelf side", () => {
    const low = designBiquad({ type: "lowshelf", frequency: 300, gainDb: -6 }, SAMPLE_RATE);
    const high = designBiquad({ type: "highshelf", frequency: 4000, gainDb: 5 }, SAMPLE_RATE);
    expect(biquadMagnitudeDb(low, 20, SAMPLE_RATE)).toBeCloseTo(-6, 1);
    expect(biquadMagnitudeDb(low, 15000, SAMPLE_RATE)).toBeCloseTo(0, 1);
    expect(biquadMagnitudeDb(high, 20000, SAMPLE_RATE)).toBeCloseTo(5, 1);
    expect(biquadMagnitudeDb(high, 50, SAMPLE_RATE)).toBeCloseTo(0, 1);
  });

  it("notch removes the centre frequency; bandpass peaks at 0 dB", () => {
    const notch = designBiquad({ type: "notch", frequency: 50, q: 10 }, SAMPLE_RATE);
    const band = designBiquad({ type: "bandpass", frequency: 3000 }, SAMPLE_RATE);
    expect(biquadMagnitudeDb(notch, 50, SAMPLE_RATE)).toBeLessThan(-60);
    expect(biquadMagnitudeDb(band, 3000, SAMPLE_RATE)).toBeCloseTo(0, 3);
  });

  it("rejects invalid parameters", () => {
    expect(() => designBiquad({ type: "lowpass", frequency: 0 }, SAMPLE_RATE)).toThrow(RangeError);
    expect(() => designBiquad({ type: "lowpass", frequency: 24000 }, SAMPLE_RATE)).toThrow(RangeError);
    expect(() => designBiquad({ type: "lowpass", frequency: 1000, q: 0 }, SAMPLE_RATE)).toThrow(RangeError);
    expect(() => designBiquad({ type: "lowpass", frequency: 1000 }, 0)).toThrow(RangeError);
    expect(() =>
      designBiquad({ type: "nope" as never, frequency: 1000 }, SAMPLE_RATE),
    ).toThrow(TypeError);
  });
});

describe("WASM build artifacts", () => {
  it("detects wasm SIMD support in this runtime", () => {
    expect(isWasmSimdSupported()).toBe(true);
  });

  it("ships a SIMD build and a scalar fallback build", async () => {
    const simd = await AudioFilterPipeline.fromBinary(simdBinary);
    const scalar = await AudioFilterPipeline.fromBinary(scalarBinary);
    expect(simd.simd).toBe(true);
    expect(scalar.simd).toBe(false);
    expect(simd.maxChannels).toBe(8);
    expect(simd.maxStages).toBe(8);
  });

  it("is self-contained (no imports needed to instantiate)", () => {
    for (const bin of [simdBinary, scalarBinary]) {
      expect(WebAssembly.Module.imports(new WebAssembly.Module(bin))).toEqual([]);
    }
  });
});

describe.each([
  ["SIMD", simdBinary],
  ["scalar", scalarBinary],
])("AudioFilterPipeline (%s build)", (_name, binary) => {
  let pipeline: AudioFilterPipeline;
  const coefficients = CHAIN.map((s) => designBiquad(s, SAMPLE_RATE));

  beforeEach(async () => {
    pipeline = await AudioFilterPipeline.fromBinary(binary);
    pipeline.setStages(CHAIN, SAMPLE_RATE);
  });

  // 6 channels = one full SIMD group + one partial; 1027 frames has a 3-frame tail
  it.each([
    [1, 128],
    [2, 1027],
    [4, 512],
    [6, 1027],
    [8, 256],
  ])("matches the JS reference for %i channels x %i frames", (numChannels, frames) => {
    const input = Array.from({ length: numChannels }, (_, c) => noise(frames, c + 1));
    const expected = referenceFilter(input, coefficients);
    const actual = input.map((ch) => Float32Array.from(ch));
    pipeline.process(actual);
    actual.forEach((ch, c) => {
      expect(maxAbsDiff(ch, expected[c])).toBeLessThan(1e-5);
    });
  });

  it("keeps filter state continuous across render quanta", () => {
    const frames = RENDER_QUANTUM * 10;
    const input = [noise(frames, 11), noise(frames, 12), noise(frames, 13)];
    const expected = referenceFilter(input, coefficients);

    const actual = input.map((ch) => Float32Array.from(ch));
    for (let off = 0; off < frames; off += RENDER_QUANTUM) {
      pipeline.process(actual.map((ch) => ch.subarray(off, off + RENDER_QUANTUM)));
    }
    actual.forEach((ch, c) => {
      expect(maxAbsDiff(ch, expected[c])).toBeLessThan(1e-5);
    });
  });

  it("chunks buffers longer than maxFrames without breaking continuity", () => {
    const frames = pipeline.maxFrames * 2 + 100;
    const input = [noise(frames, 21), noise(frames, 22)];
    const expected = referenceFilter(input, coefficients);
    const actual = input.map((ch) => Float32Array.from(ch));
    pipeline.process(actual);
    actual.forEach((ch, c) => {
      expect(maxAbsDiff(ch, expected[c])).toBeLessThan(1e-4);
    });
  });

  it("filters each channel independently", () => {
    pipeline.setStages([{ type: "lowpass", frequency: 500 }], SAMPLE_RATE);
    const frames = 4800;
    const low = sine(100, frames);
    const high = sine(10000, frames);
    const channels = [Float32Array.from(low), Float32Array.from(high), new Float32Array(frames)];
    pipeline.process(channels);

    expect(rms(channels[0], 480) / rms(low, 480)).toBeGreaterThan(0.95);
    expect(rms(channels[1], 480) / rms(high, 480)).toBeLessThan(0.01);
    expect(rms(channels[2])).toBe(0);
  });

  it("applies the output gain after the filter chain", () => {
    pipeline.setStages([], SAMPLE_RATE);
    pipeline.setOutputGain(0.5);
    const ch = new Float32Array([1, -1, 0.5, 0.25, 2]);
    pipeline.process([ch]);
    expect(Array.from(ch)).toEqual([0.5, -0.5, 0.25, 0.125, 1]);
  });

  it("passes audio through unchanged with no stages", () => {
    pipeline.setStages([], SAMPLE_RATE);
    const input = noise(300, 5);
    const ch = Float32Array.from(input);
    pipeline.process([ch]);
    expect(Array.from(ch)).toEqual(Array.from(input));
  });

  it("reset() clears the delay lines", () => {
    const impulse = new Float32Array(64);
    impulse[0] = 1;
    const first = Float32Array.from(impulse);
    pipeline.process([first]);

    pipeline.reset();
    const second = Float32Array.from(impulse);
    pipeline.process([second]);
    expect(Array.from(second)).toEqual(Array.from(first));
  });

  it("validates channel counts, lengths and stage counts", () => {
    expect(() => pipeline.process([])).toThrow(RangeError);
    expect(() =>
      pipeline.process(Array.from({ length: 9 }, () => new Float32Array(8))),
    ).toThrow(RangeError);
    expect(() =>
      pipeline.process([new Float32Array(8), new Float32Array(4)]),
    ).toThrow(RangeError);
    expect(() =>
      pipeline.setStages(
        Array.from({ length: 9 }, () => ({ type: "lowpass" as const, frequency: 1000 })),
        SAMPLE_RATE,
      ),
    ).toThrow(RangeError);
  });

  it("processes 8-channel render quanta well under 5 ms", () => {
    pipeline.setStages(CHAIN.concat(CHAIN), SAMPLE_RATE); // 8-stage worst case
    const channels = Array.from({ length: 8 }, (_, c) => noise(RENDER_QUANTUM, c + 100));

    for (let i = 0; i < 20; i++) pipeline.process(channels); // warm up the JIT
    const timings: number[] = [];
    for (let i = 0; i < 200; i++) timings.push(pipeline.process(channels));
    timings.sort((a, b) => a - b);

    const median = timings[Math.floor(timings.length / 2)];
    const p99 = timings[Math.floor(timings.length * 0.99)];
    expect(median).toBeLessThan(5);
    expect(p99).toBeLessThan(5);
  });
});

describe("SIMD vs scalar path parity", () => {
  it("produces identical output whichever path runs", async () => {
    const simd = await AudioFilterPipeline.fromBinary(simdBinary);
    const scalarPath = await AudioFilterPipeline.fromBinary(simdBinary);
    scalarPath.setSimdEnabled(false);
    simd.setStages(CHAIN, SAMPLE_RATE);
    scalarPath.setStages(CHAIN, SAMPLE_RATE);

    const input = Array.from({ length: 7 }, (_, c) => noise(515, c + 40));
    const a = input.map((ch) => Float32Array.from(ch));
    const b = input.map((ch) => Float32Array.from(ch));
    simd.process(a);
    scalarPath.process(b);
    a.forEach((ch, c) => expect(maxAbsDiff(ch, b[c])).toBeLessThan(1e-6));
  });
});

describe("loadAudioFilterPipeline", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("fetches the SIMD build when supported and the scalar build when forced", async () => {
    const fetchMock = jest.fn(async (url: string) => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => {
        const bytes = url.includes("simd") ? simdBinary : scalarBinary;
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const simd = await loadAudioFilterPipeline();
    expect(fetchMock).toHaveBeenLastCalledWith("/audio-filter-simd.wasm");
    expect(simd.simd).toBe(true);

    const scalar = await loadAudioFilterPipeline({ forceScalar: true });
    expect(fetchMock).toHaveBeenLastCalledWith("/audio-filter-scalar.wasm");
    expect(scalar.simd).toBe(false);
  });

  it("throws when the binary cannot be fetched", async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 404 })) as unknown as typeof fetch;
    await expect(loadAudioFilterPipeline()).rejects.toThrow(/404/);
  });
});
