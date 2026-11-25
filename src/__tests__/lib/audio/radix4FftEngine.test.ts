/**
 * radix4FftEngine.test.ts
 *
 * Focused unit tests for WebAssembly SIMD Accelerated 2048-point Radix-4 FFT Engine (#7630).
 */

import fs from "node:fs";
import path from "node:path";
import {
  Radix4FftEngine,
  FFT_SIZE,
  HALF_FFT_SIZE,
  isWasmSimdSupported,
  createHannWindow,
  createBitReversalTable,
  magnitudeToDecibels,
} from "@/lib/audio/radix4FftEngine";

describe("WebAssembly SIMD 2048-point Radix-4 FFT Engine (#7630)", () => {
  const wasmPath = path.resolve("public/wasm/radix4_fft_simd.wasm");

  it("verifies 2048-point FFT constants and bit reversal indexing", () => {
    expect(FFT_SIZE).toBe(2048);
    expect(HALF_FFT_SIZE).toBe(1024);

    const table = createBitReversalTable(2048);
    expect(table.length).toBe(2048);
    expect(table[0]).toBe(0);
    expect(table[1]).toBe(1024); // 1 reversed across 11 bits: 2^10 = 1024
    expect(table[2]).toBe(512);  // 2 reversed: 2^9 = 512
  });

  it("creates valid Hann window function", () => {
    const window = createHannWindow(2048);
    expect(window.length).toBe(2048);
    expect(window[0]).toBeCloseTo(0.0, 5);
    expect(window[1024]).toBeCloseTo(1.0, 1);
    expect(window[2047]).toBeCloseTo(0.0, 5);
  });

  it("detects WebAssembly SIMD support in current environment", () => {
    const supported = isWasmSimdSupported();
    expect(typeof supported).toBe("boolean");
    // Node.js v24 supports WebAssembly SIMD
    expect(supported).toBe(true);
  });

  it("loads and initializes SIMD WebAssembly module", async () => {
    expect(fs.existsSync(wasmPath)).toBe(true);
    const wasmBytes = fs.readFileSync(wasmPath);

    const engine = new Radix4FftEngine();
    const ok = await engine.init({ wasmBytes });
    expect(ok).toBe(true);
    expect(engine.isSimd()).toBe(true);
  });

  it("falls back cleanly to scalar path when SIMD is forced false or unsupported", async () => {
    const engine = new Radix4FftEngine();
    await engine.init({ forceScalar: true });
    expect(engine.isSimd()).toBe(false);
  });

  it("falls back gracefully when SIMD instantiation fails", async () => {
    const engine = new Radix4FftEngine();
    // Invalid wasm bytes
    const invalidBytes = new Uint8Array([0, 1, 2, 3]);
    await engine.init({ wasmBytes: invalidBytes });
    expect(engine.isSimd()).toBe(false);
  });

  it("computes 2048-point FFT for a known pure sine wave signal", async () => {
    const engine = new Radix4FftEngine();
    const wasmBytes = fs.readFileSync(wasmPath);
    await engine.init({ wasmBytes });

    const sampleRate = 48000;
    const targetFreq = 1000; // 1000 Hz tone
    const input = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) {
      input[i] = Math.sin((2 * Math.PI * targetFreq * i) / sampleRate);
    }

    const res = engine.process(input, sampleRate);
    expect(res.decibels.length).toBe(1024);
    expect(res.real.length).toBe(2048);
    expect(res.imag.length).toBe(2048);

    // Bin for 1000 Hz at 48000 sample rate with 2048 points:
    // bin = 1000 * 2048 / 48000 = 42.66 -> bin 43 (~1007.8 Hz)
    expect(res.dominantFrequencyHz).toBeCloseTo(1007.8, 0);
    expect(res.peakDb).toBeGreaterThan(-20.0);
  });

  it("produces equivalent results between SIMD and scalar paths within tolerance", async () => {
    const wasmBytes = fs.readFileSync(wasmPath);

    const simdEngine = new Radix4FftEngine();
    await simdEngine.init({ wasmBytes });

    const scalarEngine = new Radix4FftEngine();
    await scalarEngine.init({ forceScalar: true });

    // Generate multitone test signal
    const sampleRate = 48000;
    const input = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) {
      input[i] =
        0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate) +
        0.25 * Math.sin((2 * Math.PI * 2500 * i) / sampleRate);
    }

    const simdRes = simdEngine.process(input, sampleRate);
    const scalarRes = scalarEngine.process(input, sampleRate);

    expect(simdRes.dominantFrequencyHz).toBe(scalarRes.dominantFrequencyHz);
    expect(simdRes.peakDb).toBeCloseTo(scalarRes.peakDb, 1);

    for (let b = 0; b < 1024; b++) {
      expect(simdRes.decibels[b]).toBeCloseTo(scalarRes.decibels[b], 0);
    }
  });

  it("handles silent input gracefully without NaN or infinite decibels", () => {
    const engine = new Radix4FftEngine();
    const silence = new Float32Array(2048); // all zeros

    const res = engine.processScalar(silence);
    expect(res.decibels.length).toBe(1024);
    for (let i = 0; i < res.decibels.length; i++) {
      expect(Number.isFinite(res.decibels[i])).toBe(true);
      expect(res.decibels[i]).toBe(-100.0);
    }
    expect(res.peakDb).toBe(-100.0);
  });

  it("handles invalid and non-finite input (NaN, Infinity) safely", () => {
    const engine = new Radix4FftEngine();
    const invalid = new Float32Array(2048);
    invalid[0] = NaN;
    invalid[10] = Infinity;
    invalid[20] = -Infinity;

    const res = engine.processScalar(invalid);
    for (let i = 0; i < res.decibels.length; i++) {
      expect(Number.isFinite(res.decibels[i])).toBe(true);
      expect(Number.isNaN(res.decibels[i])).toBe(false);
    }
  });

  it("achieves 2048-point SIMD FFT computation under 2ms", async () => {
    const wasmBytes = fs.readFileSync(wasmPath);
    const engine = new Radix4FftEngine();
    await engine.init({ wasmBytes });

    const input = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) {
      input[i] = Math.random() * 2 - 1;
    }

    // Warm-up run
    engine.process(input);

    // Benchmarked run
    const iterations = 50;
    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) {
      engine.process(input);
    }
    const avgTimeMs = (performance.now() - t0) / iterations;

    expect(avgTimeMs).toBeLessThan(2.0);
    console.log(`Measured 2048-point SIMD FFT execution time: ${avgTimeMs.toFixed(3)} ms (target: < 2.0 ms)`);
  });

  it("converts magnitudes to decibels with boundary clamping [-100 dB, +20 dB]", () => {
    const real = new Float32Array(2048);
    const imag = new Float32Array(2048);

    // Extreme high value
    real[0] = 100000.0;
    imag[0] = 100000.0;

    // Extreme low value
    real[1] = 0.0;
    imag[1] = 0.0;

    const db = magnitudeToDecibels(real, imag, 2048);
    expect(db[0]).toBe(20.0);
    expect(db[1]).toBe(-100.0);
  });
});
