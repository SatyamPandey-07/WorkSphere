/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';
import {
  WasmSoundClassifier,
  SOUND_FRAME_LENGTH,
  MFCC_COUNT,
  isWasmSimdSupported,
} from '@/core/audio/WasmSoundClassifier';

const SR = 16000;
const readWasm = (name: string) => fs.readFileSync(path.join(process.cwd(), 'public', name));
const SIMD_BYTES = readWasm('sound_classifier.wasm');
const SCALAR_BYTES = readWasm('sound_classifier_scalar.wasm');

// Deterministic PRNG in [-1, 1).
function rng(seed = 1) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2147483648 - 1;
  };
}

const sine = (hz: number, amp = 0.5) =>
  Float32Array.from({ length: SOUND_FRAME_LENGTH }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));

const noise = (amp = 0.3, seed = 7) => {
  const r = rng(seed);
  return Float32Array.from({ length: SOUND_FRAME_LENGTH }, () => amp * r());
};

// Harmonics of a 150 Hz voice between 300 and 3000 Hz over a faint noise floor.
const voiceLike = () => {
  const r = rng(11);
  return Float32Array.from({ length: SOUND_FRAME_LENGTH }, (_, i) => {
    let v = 0;
    for (let h = 2; h <= 20; h++) v += Math.sin((2 * Math.PI * 150 * h * i) / SR);
    return 0.03 * v + 0.01 * r();
  });
};

// O(N^2) reference: Hann-windowed DFT power spectrum -> spectral centroid in Hz.
function referenceCentroid(frame: Float32Array): number {
  const N = SOUND_FRAME_LENGTH;
  let num = 0;
  let den = 0;
  for (let k = 0; k <= N / 2; k++) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < N; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
      const a = (-2 * Math.PI * k * i) / N;
      re += frame[i] * w * Math.cos(a);
      im += frame[i] * w * Math.sin(a);
    }
    const p = re * re + im * im;
    num += ((k * SR) / N) * p;
    den += p;
  }
  return num / den;
}

describe('WasmSoundClassifier (#7277)', () => {
  let simd: WasmSoundClassifier;
  let scalar: WasmSoundClassifier;

  beforeAll(async () => {
    simd = await WasmSoundClassifier.create({ sampleRate: SR, wasmBytes: SIMD_BYTES });
    scalar = await WasmSoundClassifier.create({ sampleRate: SR, wasmBytes: SCALAR_BYTES });
  });

  it('detects wasm SIMD support and reports which build is running', () => {
    expect(isWasmSimdSupported()).toBe(true);
    expect(simd.simd).toBe(true);
    expect(scalar.simd).toBe(false);
  });

  it('modules declare zero imports, so they cannot reach the network or JS', () => {
    for (const bytes of [SIMD_BYTES, SCALAR_BYTES]) {
      expect(WebAssembly.Module.imports(new WebAssembly.Module(bytes))).toEqual([]);
    }
  });

  it('computes 13 finite MFCCs plus feature values', () => {
    const f = simd.classify(noise());
    expect(f.mfcc).toHaveLength(MFCC_COUNT);
    expect([...f.mfcc, f.spectralCentroidHz, f.rmsDbfs, f.spectralFlatness, f.speechBandRatio].every(Number.isFinite)).toBe(true);
  });

  it('spectral centroid of a pure tone lands on the tone frequency', () => {
    for (const hz of [500, 1000, 3000]) {
      expect(Math.abs(simd.classify(sine(hz)).spectralCentroidHz - hz)).toBeLessThan(40);
    }
  });

  it('matches an independent DFT reference for the spectral centroid', () => {
    for (const frame of [noise(0.3, 3), voiceLike(), sine(1234.5)]) {
      const want = referenceCentroid(frame);
      const got = simd.classify(frame).spectralCentroidHz;
      expect(Math.abs(got - want) / want).toBeLessThan(0.005);
    }
  });

  it('SIMD and scalar builds agree', () => {
    for (const frame of [noise(0.3, 1), noise(0.05, 2), voiceLike(), sine(777)]) {
      const a = simd.classify(frame);
      const b = scalar.classify(frame);
      expect(a.label).toBe(b.label);
      expect(Math.abs(a.spectralCentroidHz - b.spectralCentroidHz)).toBeLessThan(0.5);
      for (let i = 0; i < MFCC_COUNT; i++) expect(Math.abs(a.mfcc[i] - b.mfcc[i])).toBeLessThan(0.02);
    }
  });

  it('labels silence, broadband grinder-like noise and voice-like chatter', () => {
    expect(simd.classify(new Float32Array(SOUND_FRAME_LENGTH)).label).toBe('silence');
    expect(simd.classify(noise(0.3)).label).toBe('grinder');
    expect(simd.classify(voiceLike()).label).toBe('chatter');
  });

  it('zero-pads short frames and rejects invalid ones', () => {
    const short = sine(1000).subarray(0, 700);
    const padded = new Float32Array(SOUND_FRAME_LENGTH);
    padded.set(short);
    expect(simd.classify(short).mfcc).toEqual(simd.classify(padded).mfcc);

    expect(() => simd.classify(new Float32Array(0))).toThrow(RangeError);
    expect(() => simd.classify(new Float32Array(2048))).toThrow(RangeError);
    const bad = new Float32Array(SOUND_FRAME_LENGTH);
    bad[10] = NaN;
    expect(() => simd.classify(bad)).toThrow(/NaN or Infinity/);
    // A rejected frame must not poison later ones.
    expect(simd.classify(sine(1000)).label).toBe('chatter');
  });

  it('rejects unsupported sample rates and use after dispose', async () => {
    await expect(WasmSoundClassifier.create({ sampleRate: 100, wasmBytes: SIMD_BYTES })).rejects.toThrow(RangeError);
    const c = await WasmSoundClassifier.create({ sampleRate: SR, wasmBytes: SIMD_BYTES });
    c.dispose();
    expect(() => c.classify(sine(1000))).toThrow(/disposed/);
  });

  it('processes a 1024-sample frame in well under 2 ms (median and p95)', () => {
    const frames = [noise(0.3, 5), voiceLike(), sine(2000)];
    for (let i = 0; i < 200; i++) simd.classify(frames[i % 3]); // warm-up
    const times: number[] = [];
    for (let i = 0; i < 2000; i++) times.push(simd.classify(frames[i % 3]).processingMs);
    times.sort((a, b) => a - b);
    expect(times[1000]).toBeLessThan(2);
    expect(times[1900]).toBeLessThan(2);
  });

  it('only fetches the wasm code and never sends audio anywhere', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => SIMD_BYTES.buffer.slice(SIMD_BYTES.byteOffset, SIMD_BYTES.byteOffset + SIMD_BYTES.byteLength),
    }));
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const c = await WasmSoundClassifier.create({ sampleRate: SR });
      for (let i = 0; i < 100; i++) c.classify(noise(0.2, i + 1));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const calls = fetchMock.mock.calls as unknown as unknown[][];
      expect(calls[0]).toEqual(['/sound_classifier.wasm']); // URL only: no body, no options
    } finally {
      globalThis.fetch = original;
    }
  });
});
