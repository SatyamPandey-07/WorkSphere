import fs from "node:fs";
import path from "node:path";

describe("WebAssembly SIMD FFT Analyzer (#7230)", () => {
  const wasmPath = path.resolve("public/wasm/fft_analyzer.wasm");

  it("loads valid WebAssembly binary containing 128-bit SIMD exports", async () => {
    expect(fs.existsSync(wasmPath)).toBe(true);
    const bytes = fs.readFileSync(wasmPath);
    const { instance } = await WebAssembly.instantiate(bytes);
    const exports = instance.exports as Record<string, unknown>;

    expect(exports.memory).toBeInstanceOf(WebAssembly.Memory);
    expect(typeof exports.applyWindowAndEnergySimd).toBe("function");
    expect(typeof exports.fftButterflySimd).toBe("function");
    expect(typeof exports.computeMagnitudeSimd).toBe("function");
  });

  it("computes SIMD window energy and spectral magnitude accurately under 5ms", async () => {
    const bytes = fs.readFileSync(wasmPath);
    const { instance } = await WebAssembly.instantiate(bytes);
    const wasm = instance.exports as {
      memory: WebAssembly.Memory;
      applyWindowAndEnergySimd: (
        inP: number,
        winP: number,
        outP: number,
        len: number,
      ) => number;
      computeMagnitudeSimd: (
        rP: number,
        iP: number,
        mP: number,
        bins: number,
        invN: number,
      ) => void;
    };

    const view = new Float32Array(wasm.memory.buffer);
    const len = 512;
    for (let i = 0; i < len; i++) {
      view[i] = 0.5;
      view[(16384 >> 2) + i] = 1.0;
    }

    const t0 = performance.now();
    const energy = wasm.applyWindowAndEnergySimd(0, 16384, 0, len);
    const elapsed = performance.now() - t0;

    expect(energy).toBeCloseTo(len * 0.25, 3);
    expect(elapsed).toBeLessThan(5);
  });
});
