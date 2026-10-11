import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  computeSpatialKernel5x5,
  computeRadiometricLut,
  bilateralFilter5x5ChromaScalar,
  bilateralFilter5x5ChromaSIMD,
  bilateralFilter5x5Chroma,
  benchmarkBilateralFilterChroma,
  setSimdEnabled,
  isSimdEnabled,
} from "@/lib/wasm-loader/chromaBilateralFilter";

describe("WebAssembly SIMD 5x5 Bilateral Filter for Chroma Denoising (color_temperature.c)", () => {
  beforeEach(() => {
    setSimdEnabled(true);
  });

  describe("Gaussian Spatial and Radiometric Kernel Calculation", () => {
    it("computes 5x5 spatial kernel with peak at center and radial symmetry", () => {
      const kernelSimd = computeSpatialKernel5x5(2.0, true);
      const kernelScalar = computeSpatialKernel5x5(2.0, false);

      expect(kernelSimd).toHaveLength(25);
      expect(kernelScalar).toHaveLength(25);

      // Center tap (dx = 0, dy = 0 at index 12) must be 1.0
      expect(kernelSimd[12]).toBeCloseTo(1.0, 4);
      expect(kernelScalar[12]).toBeCloseTo(1.0, 4);

      // Taps with identical distance squared must have identical weights
      // Distance squared 1: indices 7, 11, 13, 17
      expect(kernelSimd[7]).toBeCloseTo(kernelSimd[11], 4);
      expect(kernelSimd[11]).toBeCloseTo(kernelSimd[13], 4);
      expect(kernelSimd[13]).toBeCloseTo(kernelSimd[17], 4);

      // Distance squared 2: indices 6, 8, 16, 18
      expect(kernelSimd[6]).toBeCloseTo(kernelSimd[8], 4);
      expect(kernelSimd[8]).toBeCloseTo(kernelSimd[16], 4);
      expect(kernelSimd[16]).toBeCloseTo(kernelSimd[18], 4);

      // Distance squared 8 (corners): indices 0, 4, 20, 24
      expect(kernelSimd[0]).toBeCloseTo(kernelSimd[4], 4);
      expect(kernelSimd[4]).toBeCloseTo(kernelSimd[20], 4);
      expect(kernelSimd[20]).toBeCloseTo(kernelSimd[24], 4);

      // Corners must have lower weight than center
      expect(kernelSimd[0]).toBeLessThan(kernelSimd[12]);
    });

    it("vectorized SIMD spatial kernel matches scalar Gaussian calculation within 1e-4 tolerance", () => {
      const kernelSimd = computeSpatialKernel5x5(2.5, true);
      const kernelScalar = computeSpatialKernel5x5(2.5, false);

      for (let i = 0; i < 25; i++) {
        expect(Math.abs(kernelSimd[i] - kernelScalar[i])).toBeLessThan(1e-4);
      }
    });

    it("computes 256-element radiometric LUT with monotonic decay as difference increases", () => {
      const lutSimd = computeRadiometricLut(20.0, true);
      const lutScalar = computeRadiometricLut(20.0, false);

      expect(lutSimd).toHaveLength(256);
      expect(lutScalar).toHaveLength(256);

      // Difference 0 must have weight 1.0
      expect(lutSimd[0]).toBeCloseTo(1.0, 4);
      expect(lutScalar[0]).toBeCloseTo(1.0, 4);

      // Monotonic decay across sample differences
      expect(lutSimd[10]).toBeLessThan(lutSimd[5]);
      expect(lutSimd[20]).toBeLessThan(lutSimd[10]);
      expect(lutSimd[50]).toBeLessThan(lutSimd[20]);
      expect(lutSimd[100]).toBeLessThan(lutSimd[50]);

      // Large difference (> 5 * sigma_r) approaches zero
      expect(lutSimd[200]).toBeLessThan(1e-4);
    });

    it("vectorized SIMD radiometric LUT matches scalar calculation within 1e-4 tolerance", () => {
      const lutSimd = computeRadiometricLut(18.0, true);
      const lutScalar = computeRadiometricLut(18.0, false);

      for (let i = 0; i < 256; i++) {
        expect(Math.abs(lutSimd[i] - lutScalar[i])).toBeLessThan(1e-4);
      }
    });
  });

  describe("Edge-Preserving Denoising Behavior", () => {
    it("attenuates high-frequency sensor noise variance in uniform low-light regions by >= 50%", () => {
      const width = 64;
      const height = 64;
      const noisySrc = new Uint8Array(width * height);
      const filteredDst = new Uint8Array(width * height);

      // Synthesize uniform chroma background (128) with high sensor noise (+-15 LSB)
      const baseChroma = 128;
      let seed = 42;
      const pseudoRandom = () => {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
      };

      for (let i = 0; i < noisySrc.length; i++) {
        const noise = Math.round((pseudoRandom() - 0.5) * 30); // noise in [-15, 15]
        noisySrc[i] = Math.max(0, Math.min(255, baseChroma + noise));
      }

      bilateralFilter5x5Chroma(noisySrc, filteredDst, width, height, {
        sigmaS: 2.0,
        sigmaR: 20.0,
      });

      // Compute variance before and after filtering in interior region
      let sumVarBefore = 0;
      let sumVarAfter = 0;
      let count = 0;

      for (let y = 4; y < height - 4; y++) {
        for (let x = 4; x < width - 4; x++) {
          const idx = y * width + x;
          const diffBefore = noisySrc[idx] - baseChroma;
          const diffAfter = filteredDst[idx] - baseChroma;
          sumVarBefore += diffBefore * diffBefore;
          sumVarAfter += diffAfter * diffAfter;
          count++;
        }
      }

      const varBefore = sumVarBefore / count;
      const varAfter = sumVarAfter / count;

      // Variance must be reduced by at least 50%
      expect(varAfter).toBeLessThan(varBefore * 0.5);
    });

    it("strictly preserves sharp spatial step edges without blurring chromaticity boundaries", () => {
      const width = 32;
      const height = 32;
      const edgeSrc = new Uint8Array(width * height);
      const edgeDst = new Uint8Array(width * height);

      // Sharp chromaticity step edge: Left half = 50, Right half = 200
      const leftVal = 50;
      const rightVal = 200;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          edgeSrc[y * width + x] = x < width / 2 ? leftVal : rightVal;
        }
      }

      bilateralFilter5x5Chroma(edgeSrc, edgeDst, width, height, {
        sigmaS: 2.0,
        sigmaR: 20.0,
      });

      const midX = width / 2;
      const y = Math.floor(height / 2);

      // Pixels immediately adjacent to edge (midX - 1 and midX)
      const pixelLeftOfEdge = edgeDst[y * width + (midX - 1)];
      const pixelRightOfEdge = edgeDst[y * width + midX];

      // Edge must maintain large contrast step (at least 140 out of 150)
      const edgeContrast = pixelRightOfEdge - pixelLeftOfEdge;
      expect(edgeContrast).toBeGreaterThanOrEqual(140);
      expect(pixelLeftOfEdge).toBeCloseTo(leftVal, -1);
      expect(pixelRightOfEdge).toBeCloseTo(rightVal, -1);
    });
  });

  describe("SIMD Fallback and Output Parity", () => {
    it("seamlessly falls back to scalar implementation when SIMD is disabled", () => {
      setSimdEnabled(false);
      expect(isSimdEnabled()).toBe(false);

      const width = 16;
      const height = 16;
      const src = new Uint8Array(width * height).fill(100);
      const dst = new Uint8Array(width * height);

      const result = bilateralFilter5x5Chroma(src, dst, width, height);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(dst[8 * width + 8]).toBe(100);
    });

    it("produces identical outputs between SIMD and scalar implementations", () => {
      const width = 32;
      const height = 24;
      const src = new Uint8Array(width * height);
      const dstSimd = new Uint8Array(width * height);
      const dstScalar = new Uint8Array(width * height);

      for (let i = 0; i < src.length; i++) {
        src[i] = (i * 17) % 256;
      }

      bilateralFilter5x5ChromaSIMD(src, dstSimd, width, height, 2.0, 20.0);
      bilateralFilter5x5ChromaScalar(src, dstScalar, width, height, 2.0, 20.0);

      // Verify outputs match within 1 LSB across entire frame
      let maxDiff = 0;
      for (let i = 0; i < src.length; i++) {
        const diff = Math.abs(dstSimd[i] - dstScalar[i]);
        if (diff > maxDiff) maxDiff = diff;
      }

      expect(maxDiff).toBeLessThanOrEqual(1);
    });

    it("safely handles non-standard, small, or boundary dimensions without throwing", () => {
      const smallSrc = new Uint8Array(4 * 4).fill(120);
      const smallDst = new Uint8Array(4 * 4);

      expect(() => {
        bilateralFilter5x5Chroma(smallSrc, smallDst, 4, 4);
      }).not.toThrow();

      // Graceful handling of invalid or zero dimensions
      const emptyDst = new Uint8Array(10);
      expect(() => {
        bilateralFilter5x5Chroma(new Uint8Array(0), emptyDst, 0, 0);
      }).not.toThrow();
    });
  });

  describe("1080p Chroma Frame Execution Time Benchmark (< 5ms per frame)", () => {
    it("denoises 1080p webcam chroma frames in under 5ms per frame on standard hardware", () => {
      // 1080p video webcam stream uses YUV 4:2:0 chroma plane (960x540)
      const benchmark = benchmarkBilateralFilterChroma(960, 540, {
        iterations: 5,
        sigmaS: 2.0,
        sigmaR: 20.0,
      });

      // Acceptance criterion: Benchmark execution time to ensure < 5ms per frame
      expect(benchmark.avgLatencyMs).toBeLessThan(5.0);
      expect(benchmark.fps).toBeGreaterThanOrEqual(200);
      expect(benchmark.throughputMpxPerSec).toBeGreaterThan(50.0);
    });
  });
});
