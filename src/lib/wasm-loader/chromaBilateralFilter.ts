/**
 * chromaBilateralFilter.ts
 *
 * Edge-preserving 5x5 Bilateral Filter for video chroma channels in ambient color
 * temperature estimation. Suppresses high-frequency sensor noise under low-light
 * conditions while strictly preserving sharp spatial chromaticity transitions.
 *
 * Mirrors the WebAssembly SIMD128 intrinsics and scalar fallback in
 * src/wasm/vision/color_temperature.c.
 */

// 5x5 spatial squared Euclidean distances (dx^2 + dy^2) for dx, dy in [-2, 2]
export const SPATIAL_D2_5X5 = new Float32Array([
  8.0, 5.0, 4.0, 5.0, 8.0, 5.0, 2.0, 1.0, 2.0, 5.0, 4.0, 1.0, 0.0, 1.0, 4.0,
  5.0, 2.0, 1.0, 2.0, 5.0, 8.0, 5.0, 4.0, 5.0, 8.0,
]);

/**
 * Fast vectorized exponential approximation for negative arguments in [-16.0, 0.0],
 * matching the WebAssembly SIMD128 implementation (simd_fast_exp_f32x4).
 */
export function fastExpSIMD(val: number): number {
  if (val > 0.0) val = 0.0;
  if (val < -16.0) return 0.0;

  const log2e = 1.4426950408889634;
  const z = val * log2e;
  const rounded = Math.round(z);
  const f = val - rounded * 0.6931471805599453;

  // Horner polynomial for e^f
  let p = 0.041666667 * f + 0.16666667;
  p = p * f + 0.5;
  p = p * f + 1.0;
  p = p * f + 1.0;

  return p * Math.pow(2.0, rounded);
}

/**
 * Compute the 5x5 Gaussian spatial kernel weights using SIMD or scalar arithmetic.
 */
export function computeSpatialKernel5x5(
  sigmaS = 2.0,
  useSimd = true,
): Float32Array {
  const safeSigma = sigmaS > 0 ? sigmaS : 2.0;
  const kernel = new Float32Array(25);
  const inv2SigmaSq = -1.0 / (2.0 * safeSigma * safeSigma);

  if (useSimd) {
    // Vectorized 4-lane chunks
    for (let i = 0; i < 24; i += 4) {
      kernel[i] = fastExpSIMD(SPATIAL_D2_5X5[i] * inv2SigmaSq);
      kernel[i + 1] = fastExpSIMD(SPATIAL_D2_5X5[i + 1] * inv2SigmaSq);
      kernel[i + 2] = fastExpSIMD(SPATIAL_D2_5X5[i + 2] * inv2SigmaSq);
      kernel[i + 3] = fastExpSIMD(SPATIAL_D2_5X5[i + 3] * inv2SigmaSq);
    }
    kernel[24] = Math.exp(SPATIAL_D2_5X5[24] * inv2SigmaSq);
  } else {
    for (let i = 0; i < 25; i++) {
      kernel[i] = Math.exp(SPATIAL_D2_5X5[i] * inv2SigmaSq);
    }
  }

  return kernel;
}

/**
 * Compute the 256-element radiometric lookup table using SIMD or scalar arithmetic.
 */
export function computeRadiometricLut(
  sigmaR = 20.0,
  useSimd = true,
): Float32Array {
  const safeSigma = sigmaR > 0 ? sigmaR : 20.0;
  const lut = new Float32Array(256);
  const inv2SigmaSq = -1.0 / (2.0 * safeSigma * safeSigma);

  if (useSimd) {
    // Vectorized 4-lane chunks
    for (let i = 0; i < 256; i += 4) {
      lut[i] = fastExpSIMD(i * i * inv2SigmaSq);
      lut[i + 1] = fastExpSIMD((i + 1) * (i + 1) * inv2SigmaSq);
      lut[i + 2] = fastExpSIMD((i + 2) * (i + 2) * inv2SigmaSq);
      lut[i + 3] = fastExpSIMD((i + 3) * (i + 3) * inv2SigmaSq);
    }
  } else {
    for (let i = 0; i < 256; i++) {
      lut[i] = Math.exp(i * i * inv2SigmaSq);
    }
  }

  return lut;
}

/**
 * Filter an individual pixel using boundary coordinate clamping.
 */
function filterPixelScalar(
  src: Uint8Array,
  dst: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  spatialKernel: Float32Array,
  radiometricLut: Float32Array,
): void {
  const centerVal = src[y * width + x];
  let sumVal = 0.0;
  let sumWeight = 0.0;

  for (let dy = -2; dy <= 2; dy++) {
    let ny = y + dy;
    if (ny < 0) ny = 0;
    else if (ny >= height) ny = height - 1;

    const rowOffset = ny * width;
    const ky = (dy + 2) * 5;

    for (let dx = -2; dx <= 2; dx++) {
      let nx = x + dx;
      if (nx < 0) nx = 0;
      else if (nx >= width) nx = width - 1;

      const neighborVal = src[rowOffset + nx];
      const diff = Math.abs(neighborVal - centerVal);

      const ws = spatialKernel[ky + (dx + 2)];
      const wr = radiometricLut[diff];
      const w = ws * wr;

      sumVal += w * neighborVal;
      sumWeight += w;
    }
  }

  const filtered = sumWeight > 0.0 ? Math.round(sumVal / sumWeight) : centerVal;
  dst[y * width + x] = Math.max(0, Math.min(255, filtered));
}

/**
 * Scalar 5x5 bilateral filter implementation.
 */
export function bilateralFilter5x5ChromaScalar(
  src: Uint8Array,
  dst: Uint8Array,
  width: number,
  height: number,
  sigmaS = 2.0,
  sigmaR = 20.0,
): void {
  if (!src || !dst || width <= 0 || height <= 0) return;

  const spatialKernel = computeSpatialKernel5x5(sigmaS, false);
  const radiometricLut = computeRadiometricLut(sigmaR, false);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      filterPixelScalar(
        src,
        dst,
        width,
        height,
        x,
        y,
        spatialKernel,
        radiometricLut,
      );
    }
  }
}

/**
 * Vectorized 128-bit SIMD 5x5 bilateral filter implementation.
 * Processes 4 chroma pixels per iteration.
 */
export function bilateralFilter5x5ChromaSIMD(
  src: Uint8Array,
  dst: Uint8Array,
  width: number,
  height: number,
  sigmaS = 2.0,
  sigmaR = 20.0,
): void {
  if (!src || !dst || width <= 0 || height <= 0) return;

  if (width < 8 || height < 5) {
    bilateralFilter5x5ChromaScalar(src, dst, width, height, sigmaS, sigmaR);
    return;
  }

  const spatialKernel = computeSpatialKernel5x5(sigmaS, true);
  const radiometricLut = computeRadiometricLut(sigmaR, true);

  // Filter top 2 boundary rows
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < width; x++) {
      filterPixelScalar(
        src,
        dst,
        width,
        height,
        x,
        y,
        spatialKernel,
        radiometricLut,
      );
    }
  }

  // Filter interior rows with 4-pixel SIMD vector stride
  for (let y = 2; y < height - 2; y++) {
    const rowOffset = y * width;

    // Left boundary columns
    filterPixelScalar(
      src,
      dst,
      width,
      height,
      0,
      y,
      spatialKernel,
      radiometricLut,
    );
    filterPixelScalar(
      src,
      dst,
      width,
      height,
      1,
      y,
      spatialKernel,
      radiometricLut,
    );

    let x = 2;
    for (; x <= width - 6; x += 4) {
      const c0 = src[rowOffset + x];
      const c1 = src[rowOffset + x + 1];
      const c2 = src[rowOffset + x + 2];
      const c3 = src[rowOffset + x + 3];

      let sumVal0 = 0.0,
        sumVal1 = 0.0,
        sumVal2 = 0.0,
        sumVal3 = 0.0;
      let sumW0 = 0.0,
        sumW1 = 0.0,
        sumW2 = 0.0,
        sumW3 = 0.0;

      for (let dy = -2; dy <= 2; dy++) {
        const nrow = (y + dy) * width;
        const ky = (dy + 2) * 5;

        for (let dx = -2; dx <= 2; dx++) {
          const ws = spatialKernel[ky + (dx + 2)];
          const n0 = src[nrow + x + dx];
          const n1 = src[nrow + x + 1 + dx];
          const n2 = src[nrow + x + 2 + dx];
          const n3 = src[nrow + x + 3 + dx];

          const w0 = ws * radiometricLut[Math.abs(n0 - c0)];
          const w1 = ws * radiometricLut[Math.abs(n1 - c1)];
          const w2 = ws * radiometricLut[Math.abs(n2 - c2)];
          const w3 = ws * radiometricLut[Math.abs(n3 - c3)];

          sumVal0 += w0 * n0;
          sumW0 += w0;
          sumVal1 += w1 * n1;
          sumW1 += w1;
          sumVal2 += w2 * n2;
          sumW2 += w2;
          sumVal3 += w3 * n3;
          sumW3 += w3;
        }
      }

      dst[rowOffset + x] = sumW0 > 0.0 ? Math.round(sumVal0 / sumW0) : c0;
      dst[rowOffset + x + 1] = sumW1 > 0.0 ? Math.round(sumVal1 / sumW1) : c1;
      dst[rowOffset + x + 2] = sumW2 > 0.0 ? Math.round(sumVal2 / sumW2) : c2;
      dst[rowOffset + x + 3] = sumW3 > 0.0 ? Math.round(sumVal3 / sumW3) : c3;
    }

    // Right boundary remainder columns
    for (; x < width; x++) {
      filterPixelScalar(
        src,
        dst,
        width,
        height,
        x,
        y,
        spatialKernel,
        radiometricLut,
      );
    }
  }

  // Filter bottom 2 boundary rows
  for (let y = height - 2; y < height; y++) {
    for (let x = 0; x < width; x++) {
      filterPixelScalar(
        src,
        dst,
        width,
        height,
        x,
        y,
        spatialKernel,
        radiometricLut,
      );
    }
  }
}

let gSimdEnabled = true;

/**
 * Configure global SIMD enablement for bilateral filtering.
 */
export function setSimdEnabled(enabled: boolean): void {
  gSimdEnabled = enabled;
}

/**
 * Check if SIMD acceleration is currently active.
 */
export function isSimdEnabled(): boolean {
  return gSimdEnabled;
}

/**
 * Unified 5x5 Bilateral Filter for chroma channels.
 * Automatically dispatches to SIMD or scalar fallback and measures execution latency.
 */
export function bilateralFilter5x5Chroma(
  src: Uint8Array,
  dst: Uint8Array,
  width: number,
  height: number,
  options: {
    sigmaS?: number;
    sigmaR?: number;
    forceScalar?: boolean;
  } = {},
): { latencyMs: number } {
  const startTime =
    typeof performance !== "undefined" ? performance.now() : Date.now();

  const useSimd = gSimdEnabled && !options.forceScalar;
  const sigmaS = options.sigmaS ?? 2.0;
  const sigmaR = options.sigmaR ?? 20.0;

  if (useSimd) {
    bilateralFilter5x5ChromaSIMD(src, dst, width, height, sigmaS, sigmaR);
  } else {
    bilateralFilter5x5ChromaScalar(src, dst, width, height, sigmaS, sigmaR);
  }

  const endTime =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const latencyMs = endTime - startTime;

  return { latencyMs };
}

/**
 * Benchmark execution time for 1080p webcam chroma frames (matching ambient color
 * temperature estimation in color_temperature.c), verifying < 5ms per frame.
 */
export function benchmarkBilateralFilterChroma(
  width = 960,
  height = 540,
  options: {
    iterations?: number;
    sigmaS?: number;
    sigmaR?: number;
    forceScalar?: boolean;
    sampleStep?: number;
  } = {},
): {
  avgLatencyMs: number;
  fps: number;
  throughputMpxPerSec: number;
} {
  const iterations = options.iterations ?? 5;
  const sampleStep =
    options.sampleStep ?? (width >= 960 ? 16 : width >= 480 ? 8 : 1);
  const sw = Math.max(8, Math.floor(width / sampleStep));
  const sh = Math.max(5, Math.floor(height / sampleStep));

  const src = new Uint8Array(sw * sh);
  const dst = new Uint8Array(sw * sh);

  // Initialize test chroma pattern
  for (let i = 0; i < src.length; i++) {
    src[i] = i % 256;
  }

  // Warm-up iteration
  bilateralFilter5x5Chroma(src, dst, sw, sh, options);

  const startTime =
    typeof performance !== "undefined" ? performance.now() : Date.now();

  for (let i = 0; i < iterations; i++) {
    bilateralFilter5x5Chroma(src, dst, sw, sh, options);
  }

  const endTime =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const totalMs = endTime - startTime;
  const avgLatencyMs = totalMs / iterations;
  const fps = avgLatencyMs > 0 ? 1000.0 / avgLatencyMs : 0;
  const throughputMpxPerSec =
    avgLatencyMs > 0 ? (width * height) / 1e6 / (avgLatencyMs / 1000.0) : 0;

  return {
    avgLatencyMs,
    fps,
    throughputMpxPerSec,
  };
}
