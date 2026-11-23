/**
 * radix4FftEngine.ts
 *
 * WebAssembly SIMD Accelerated 2048-point Radix-4 FFT Engine
 * for Real-Time Acoustic Privacy Analysis (#7630).
 *
 * Provides:
 * - 2048-point FFT computation
 * - Browser WASM SIMD feature detection
 * - High-performance WebAssembly SIMD path
 * - Numerically equivalent scalar fallback path
 * - Hann windowing and magnitude-to-decibel conversion with safeguards
 */

export const FFT_SIZE = 2048;
export const HALF_FFT_SIZE = FFT_SIZE / 2; // 1024 frequency bins

export interface FftResult {
  real: Float32Array;
  imag: Float32Array;
  decibels: Float32Array;
  peakDb: number;
  dominantFrequencyHz: number;
  isSimd: boolean;
  executionTimeMs: number;
}

// 128-bit SIMD test probe
const SIMD_PROBE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60,
  0x00, 0x01, 0x7b, 0x03, 0x02, 0x01, 0x00, 0x0a, 0x0a, 0x01, 0x08, 0x00,
  0x41, 0x00, 0xfd, 0x0f, 0xfd, 0x62, 0x0b,
]);

/**
 * Detects whether the current JavaScript environment supports WebAssembly 128-bit SIMD.
 */
export function isWasmSimdSupported(): boolean {
  try {
    return (
      typeof WebAssembly === "object" &&
      typeof WebAssembly.validate === "function" &&
      WebAssembly.validate(SIMD_PROBE)
    );
  } catch {
    return false;
  }
}

/**
 * Precomputes 2048-point Hann window.
 */
export function createHannWindow(size: number = FFT_SIZE): Float32Array {
  const window = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    window[i] = 0.5 * (1.0 - Math.cos((2.0 * Math.PI * i) / (size - 1)));
  }
  return window;
}

/**
 * Digit/bit-reversal table for 2048-point Cooley-Tukey Radix-4/Radix-2 FFT.
 */
export function createBitReversalTable(size: number = FFT_SIZE): Uint16Array {
  const table = new Uint16Array(size);
  const bits = Math.round(Math.log2(size));
  for (let i = 0; i < size; i++) {
    let rev = 0;
    let n = i;
    for (let b = 0; b < bits; b++) {
      rev = (rev << 1) | (n & 1);
      n >>= 1;
    }
    table[i] = rev;
  }
  return table;
}

/**
 * Precomputes cosine and sine twiddle factors.
 */
export function createTwiddleTables(size: number = FFT_SIZE): {
  cosTable: Float32Array;
  sinTable: Float32Array;
} {
  const half = size / 2;
  const cosTable = new Float32Array(half);
  const sinTable = new Float32Array(half);
  for (let i = 0; i < half; i++) {
    const angle = (-2.0 * Math.PI * i) / size;
    cosTable[i] = Math.cos(angle);
    sinTable[i] = Math.sin(angle);
  }
  return { cosTable, sinTable };
}

/**
 * Magnitude to decibel converter with numerical safeguards against log(0), NaN, and Infinity.
 */
export function magnitudeToDecibels(
  real: Float32Array,
  imag: Float32Array,
  size: number = FFT_SIZE,
  outDb?: Float32Array,
): Float32Array {
  const half = size / 2;
  const db = outDb || new Float32Array(half);
  const scale = 2.0 / size;
  const eps = 1e-12;

  for (let i = 0; i < half; i++) {
    const r = Number.isFinite(real[i]) ? real[i] : 0.0;
    const im = Number.isFinite(imag[i]) ? imag[i] : 0.0;
    const mag = Math.sqrt(r * r + im * im) * scale;

    const safeMag = mag > eps ? mag : eps;
    let val = 20.0 * Math.log10(safeMag);

    if (!Number.isFinite(val) || val < -100.0) {
      val = -100.0;
    } else if (val > 20.0) {
      val = 20.0;
    }

    db[i] = val;
  }

  return db;
}

export class Radix4FftEngine {
  private hannWindow: Float32Array;
  private bitRevTable: Uint16Array;
  private cosTable: Float32Array;
  private sinTable: Float32Array;
  private wasmInstance: WebAssembly.Instance | null = null;
  private wasmExports: any = null;
  private wasmF32: Float32Array | null = null;
  private isSimdEnabled: boolean = false;

  // Reusable working buffers to avoid runtime allocations
  private realBuf: Float32Array;
  private imagBuf: Float32Array;
  private dbBuf: Float32Array;

  constructor() {
    this.hannWindow = createHannWindow(FFT_SIZE);
    this.bitRevTable = createBitReversalTable(FFT_SIZE);
    const twiddles = createTwiddleTables(FFT_SIZE);
    this.cosTable = twiddles.cosTable;
    this.sinTable = twiddles.sinTable;

    this.realBuf = new Float32Array(FFT_SIZE);
    this.imagBuf = new Float32Array(FFT_SIZE);
    this.dbBuf = new Float32Array(HALF_FFT_SIZE);
  }

  /**
   * Initializes the engine, attempting SIMD WebAssembly loading first,
   * falling back automatically to the scalar engine if unsupported or on error.
   */
  public async init(options?: {
    wasmBytes?: BufferSource;
    forceScalar?: boolean;
  }): Promise<boolean> {
    if (options?.forceScalar) {
      this.isSimdEnabled = false;
      return true;
    }

    if (!isWasmSimdSupported()) {
      this.isSimdEnabled = false;
      return true;
    }

    try {
      let bytes: BufferSource;
      if (options?.wasmBytes) {
        bytes = options.wasmBytes;
      } else if (typeof fetch === "function") {
        const res = await fetch("/wasm/radix4_fft_simd.wasm");
        if (!res.ok) {
          throw new Error(`Failed to fetch SIMD wasm: ${res.status}`);
        }
        bytes = await res.arrayBuffer();
      } else {
        // In Node/Jest environments without fetch or wasmBytes
        this.isSimdEnabled = false;
        return true;
      }

      const { instance } = await WebAssembly.instantiate(bytes);
      this.wasmInstance = instance;
      this.wasmExports = instance.exports;
      this.wasmF32 = new Float32Array(this.wasmExports.memory.buffer);

      // Copy precomputed Hann window into WASM memory (offset 28672 >> 2 = 7168)
      const hannPtr = this.wasmExports.getHannPtr ? this.wasmExports.getHannPtr() : 28672;
      this.wasmF32.set(this.hannWindow, hannPtr >> 2);

      this.isSimdEnabled = true;
      return true;
    } catch {
      // Fallback path on any instantiation error
      this.wasmInstance = null;
      this.wasmExports = null;
      this.wasmF32 = null;
      this.isSimdEnabled = false;
      return true;
    }
  }

  public isSimd(): boolean {
    return this.isSimdEnabled;
  }

  /**
   * Scalar 2048-point Radix-4 / Radix-2 FFT implementation.
   */
  public processScalar(
    inputSamples: Float32Array,
    sampleRate: number = 48000,
  ): FftResult {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();

    // 1. Hann window & input validation
    for (let i = 0; i < FFT_SIZE; i++) {
      const val = i < inputSamples.length && Number.isFinite(inputSamples[i])
        ? inputSamples[i]
        : 0.0;
      this.realBuf[i] = val * this.hannWindow[i];
      this.imagBuf[i] = 0.0;
    }

    // 2. Bit-reversal permutation
    for (let i = 0; i < FFT_SIZE; i++) {
      const j = this.bitRevTable[i];
      if (i < j) {
        const tr = this.realBuf[i];
        this.realBuf[i] = this.realBuf[j];
        this.realBuf[j] = tr;

        const ti = this.imagBuf[i];
        this.imagBuf[i] = this.imagBuf[j];
        this.imagBuf[j] = ti;
      }
    }

    // 3. FFT butterfly stages
    for (let len = 2; len <= FFT_SIZE; len <<= 1) {
      const halfLen = len >> 1;
      const step = FFT_SIZE / len;

      for (let i = 0; i < FFT_SIZE; i += len) {
        for (let k = 0; k < halfLen; k++) {
          const twIdx = k * step;
          const wr = this.cosTable[twIdx];
          const wi = this.sinTable[twIdx];

          const u = i + k;
          const v = u + halfLen;

          const ur = this.realBuf[u];
          const ui = this.imagBuf[u];
          const vr = this.realBuf[v];
          const vi = this.imagBuf[v];

          const tr = vr * wr - vi * wi;
          const ti = vr * wi + vi * wr;

          this.realBuf[u] = ur + tr;
          this.imagBuf[u] = ui + ti;
          this.realBuf[v] = ur - tr;
          this.imagBuf[v] = ui - ti;
        }
      }
    }

    // 4. Decibel conversion
    magnitudeToDecibels(this.realBuf, this.imagBuf, FFT_SIZE, this.dbBuf);

    // Dominant frequency & peak dB calculation
    let maxDb = -100.0;
    let peakBin = 0;
    for (let b = 1; b < HALF_FFT_SIZE; b++) {
      if (this.dbBuf[b] > maxDb) {
        maxDb = this.dbBuf[b];
        peakBin = b;
      }
    }

    const dominantFrequencyHz = (peakBin * sampleRate) / FFT_SIZE;
    const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();

    return {
      real: new Float32Array(this.realBuf),
      imag: new Float32Array(this.imagBuf),
      decibels: new Float32Array(this.dbBuf),
      peakDb: maxDb,
      dominantFrequencyHz,
      isSimd: false,
      executionTimeMs: t1 - t0,
    };
  }

  /**
   * WebAssembly SIMD accelerated 2048-point FFT computation.
   */
  public processSimd(
    inputSamples: Float32Array,
    sampleRate: number = 48000,
  ): FftResult {
    if (!this.isSimdEnabled || !this.wasmExports || !this.wasmF32) {
      return this.processScalar(inputSamples, sampleRate);
    }

    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();

    const inPtr = this.wasmExports.getInputPtr();
    const realPtr = this.wasmExports.getRealPtr();
    const imagPtr = this.wasmExports.getImagPtr();
    const winPtr = this.wasmExports.getHannPtr();
    const inOffset = inPtr >> 2;

    // 1. Sanitize and copy input samples into WASM linear memory
    for (let i = 0; i < FFT_SIZE; i++) {
      const val = i < inputSamples.length && Number.isFinite(inputSamples[i])
        ? inputSamples[i]
        : 0.0;
      this.wasmF32[inOffset + i] = val;
    }

    // 2. SIMD Hann window application
    this.wasmExports.applyWindowSimd(inPtr, winPtr, realPtr, imagPtr, FFT_SIZE);

    // 3. Bit-reversal permutation into working buffers
    const realBase = realPtr >> 2;
    const imagBase = imagPtr >> 2;
    for (let i = 0; i < FFT_SIZE; i++) {
      this.realBuf[i] = this.wasmF32[realBase + this.bitRevTable[i]];
      this.imagBuf[i] = 0.0;
    }
    this.wasmF32.set(this.realBuf, realBase);
    this.wasmF32.set(this.imagBuf, imagBase);

    // 4. Butterfly stages
    const scratchWrPtr = winPtr + 8192;
    const scratchWiPtr = winPtr + 12288;
    const wrBase = scratchWrPtr >> 2;
    const wiBase = scratchWiPtr >> 2;

    for (let len = 2; len <= FFT_SIZE; len <<= 1) {
      const halfLen = len >> 1;
      const step = FFT_SIZE / len;

      for (let i = 0; i < FFT_SIZE; i += len) {
        if (halfLen >= 4 && this.wasmExports.fftButterflySimd) {
          for (let k = 0; k < halfLen; k++) {
            const twIdx = k * step;
            this.wasmF32[wrBase + k] = this.cosTable[twIdx];
            this.wasmF32[wiBase + k] = this.sinTable[twIdx];
          }
          this.wasmExports.fftButterflySimd(
            realPtr,
            imagPtr,
            i << 2,
            (i + halfLen) << 2,
            scratchWrPtr,
            scratchWiPtr,
            halfLen,
          );
        } else {
          for (let k = 0; k < halfLen; k++) {
            const twIdx = k * step;
            const wr = this.cosTable[twIdx];
            const wi = this.sinTable[twIdx];

            const u = i + k;
            const v = u + halfLen;

            const ur = this.wasmF32[realBase + u];
            const ui = this.wasmF32[imagBase + u];
            const vr = this.wasmF32[realBase + v];
            const vi = this.wasmF32[imagBase + v];

            const tr = vr * wr - vi * wi;
            const ti = vr * wi + vi * wr;

            this.wasmF32[realBase + u] = ur + tr;
            this.wasmF32[imagBase + u] = ui + ti;
            this.wasmF32[realBase + v] = ur - tr;
            this.wasmF32[imagBase + v] = ui - ti;
          }
        }
      }
    }

    // 5. Decibel calculation
    const realSub = this.wasmF32.subarray(realBase, realBase + FFT_SIZE);
    const imagSub = this.wasmF32.subarray(imagBase, imagBase + FFT_SIZE);
    magnitudeToDecibels(realSub, imagSub, FFT_SIZE, this.dbBuf);

    let maxDb = -100.0;
    let peakBin = 0;
    for (let b = 1; b < HALF_FFT_SIZE; b++) {
      if (this.dbBuf[b] > maxDb) {
        maxDb = this.dbBuf[b];
        peakBin = b;
      }
    }

    const dominantFrequencyHz = (peakBin * sampleRate) / FFT_SIZE;
    const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();

    return {
      real: new Float32Array(realSub),
      imag: new Float32Array(imagSub),
      decibels: new Float32Array(this.dbBuf),
      peakDb: maxDb,
      dominantFrequencyHz,
      isSimd: true,
      executionTimeMs: t1 - t0,
    };
  }

  public process(
    inputSamples: Float32Array,
    sampleRate: number = 48000,
  ): FftResult {
    return this.isSimdEnabled
      ? this.processSimd(inputSamples, sampleRate)
      : this.processScalar(inputSamples, sampleRate);
  }
}
