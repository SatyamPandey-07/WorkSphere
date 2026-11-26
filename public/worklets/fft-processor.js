/**
 * AcousticFrequencyWorkletProcessor (#7230)
 * Executes 128-bit SIMD WebAssembly Fast Fourier Transform inside AudioWorkletGlobalScope
 * and posts spectral energy bins, decibel SPL, and dominant noise peaks via MessagePort (< 5ms latency).
 */

const FFT_SIZE = 512;

// Linear memory byte offsets matching wasm/fft-analyzer.wat
const IN_PTR = 0;
const REAL_PTR = 4096;
const IMAG_PTR = 8192;
const MAG_PTR = 12288;
const WIN_PTR = 16384;

function buildBitReversalTable(n) {
  const rev = new Uint16Array(n);
  const bits = Math.log2(n) | 0;
  for (let i = 0; i < n; i++) {
    let x = i;
    let y = 0;
    for (let b = 0; b < bits; b++) {
      y = (y << 1) | (x & 1);
      x >>= 1;
    }
    rev[i] = y;
  }
  return rev;
}

class FftAnalyzerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);
    this._fftSize = options?.processorOptions?.fftSize || FFT_SIZE;
    this._sampleRate =
      options?.processorOptions?.sampleRate ||
      (typeof sampleRate !== "undefined" ? sampleRate : 48000);

    this._ringBuffer = new Float32Array(this._fftSize);
    this._writeOffset = 0;
    this._bitRev = buildBitReversalTable(this._fftSize);

    // Precompute Hann window & twiddle factors
    this._hannWindow = new Float32Array(this._fftSize);
    for (let i = 0; i < this._fftSize; i++) {
      this._hannWindow[i] =
        0.5 * (1.0 - Math.cos((2.0 * Math.PI * i) / (this._fftSize - 1)));
    }

    this._cosTable = new Float32Array(this._fftSize >> 1);
    this._sinTable = new Float32Array(this._fftSize >> 1);
    for (let i = 0; i < this._fftSize >> 1; i++) {
      const angle = (-2.0 * Math.PI * i) / this._fftSize;
      this._cosTable[i] = Math.cos(angle);
      this._sinTable[i] = Math.sin(angle);
    }

    this._wasm = null;
    this._f32View = null;
    this._wasmReady = false;

    this.port.onmessage = async (event) => {
      const { type, wasmBytes, wasmModule } = event.data || {};
      if (type === "INIT_WASM") {
        await this._initWasm(wasmModule || wasmBytes);
      }
    };

    if (globalThis.__fftAnalyzerWasm) {
      this._initWasm(globalThis.__fftAnalyzerWasm);
    }
  }

  async _initWasm(source) {
    if (!source) return;
    try {
      const instantiated =
        source instanceof WebAssembly.Module
          ? await WebAssembly.instantiate(source)
          : await WebAssembly.instantiate(source);
      const instance = instantiated.instance || instantiated;
      this._wasm = instance.exports;
      this._f32View = new Float32Array(this._wasm.memory.buffer);
      // Copy precomputed Hann window into Wasm linear memory once
      this._f32View.set(this._hannWindow, WIN_PTR >> 2);
      this._wasmReady = true;
      this.port.postMessage({ type: "WASM_READY" });
    } catch (err) {
      this.port.postMessage({
        type: "WASM_ERROR",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  _runSimdFft() {
    const n = this._fftSize;
    const half = n >> 1;
    const view = this._f32View;

    // 1. Apply 128-bit SIMD Hann window & compute total frame energy
    view.set(this._ringBuffer, IN_PTR >> 2);
    const totalEnergy = this._wasm.applyWindowAndEnergySimd(
      IN_PTR,
      WIN_PTR,
      IN_PTR,
      n,
    );

    const rms = Math.sqrt(totalEnergy / n);
    const dbfs = rms > 1e-6 ? 20.0 * Math.log10(rms) : -100.0;
    const splDb = Math.max(20.0, Math.min(120.0, dbfs + 100.0));

    // 2. Bit-reversal permutation into Wasm real/imag buffers
    const realBase = REAL_PTR >> 2;
    const imagBase = IMAG_PTR >> 2;
    const inBase = IN_PTR >> 2;

    for (let i = 0; i < n; i++) {
      view[realBase + i] = view[inBase + this._bitRev[i]];
      view[imagBase + i] = 0.0;
    }

    // 3. Iterative Radix-2 Cooley-Tukey FFT with SIMD butterfly acceleration
    for (let len = 2; len <= n; len <<= 1) {
      const halfLen = len >> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        if (halfLen >= 4 && this._wasm.fftButterflySimd) {
          const wrScratch = (WIN_PTR + 4096) >> 2;
          const wiScratch = (WIN_PTR + 6144) >> 2;
          for (let k = 0; k < halfLen; k++) {
            const twIdx = k * step;
            view[wrScratch + k] = this._cosTable[twIdx];
            view[wiScratch + k] = this._sinTable[twIdx];
          }
          this._wasm.fftButterflySimd(
            REAL_PTR,
            IMAG_PTR,
            i << 2,
            (i + halfLen) << 2,
            wrScratch << 2,
            wiScratch << 2,
            halfLen,
          );
        } else {
          for (let k = 0; k < halfLen; k++) {
            const twIdx = k * step;
            const wr = this._cosTable[twIdx];
            const wi = this._sinTable[twIdx];
            const u = i + k;
            const v = u + halfLen;
            const ur = view[realBase + u];
            const ui = view[imagBase + u];
            const vr = view[realBase + v];
            const vi = view[imagBase + v];
            const tr = vr * wr - vi * wi;
            const ti = vr * wi + vi * wr;
            view[realBase + u] = ur + tr;
            view[imagBase + u] = ui + ti;
            view[realBase + v] = ur - tr;
            view[imagBase + v] = ui - ti;
          }
        }
      }
    }

    // 4. 128-bit SIMD spectral magnitude bins
    this._wasm.computeMagnitudeSimd(REAL_PTR, IMAG_PTR, MAG_PTR, half, 2.0 / n);

    const magBase = MAG_PTR >> 2;
    const bins = new Float32Array(half);
    let peakMag = 0;
    let peakBin = 0;

    for (let b = 0; b < half; b++) {
      const mag = view[magBase + b];
      bins[b] = mag;
      if (b > 0 && mag > peakMag) {
        peakMag = mag;
        peakBin = b;
      }
    }

    const dominantFrequencyHz = (peakBin * this._sampleRate) / n;
    const peakDb =
      peakMag > 1e-6
        ? Math.max(20.0, Math.min(120.0, 20.0 * Math.log10(peakMag) + 100.0))
        : 20.0;

    return {
      bins,
      splDb,
      peakDb,
      dominantFrequencyHz,
      rms,
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (input && input[0] && output && output[0]) {
      output[0].set(input[0]);
    }

    if (!input || !input[0] || input[0].length === 0) {
      return true;
    }

    const samples = input[0];
    const startTs =
      typeof performance !== "undefined" ? performance.now() : Date.now();

    for (let i = 0; i < samples.length; i++) {
      this._ringBuffer[this._writeOffset++] = samples[i];
      if (this._writeOffset >= this._fftSize) {
        this._writeOffset = 0;
        if (this._wasmReady && this._wasm) {
          const metrics = this._runSimdFft();
          const latencyMs =
            (typeof performance !== "undefined"
              ? performance.now()
              : Date.now()) - startTs;

          this.port.postMessage(
            {
              type: "SPECTRAL_FRAME",
              bins: metrics.bins,
              splDb: metrics.splDb,
              peakDb: metrics.peakDb,
              dominantFrequencyHz: metrics.dominantFrequencyHz,
              rms: metrics.rms,
              latencyMs,
            },
            [metrics.bins.buffer],
          );
        }
      }
    }

    return true;
  }
}

registerProcessor("fft-analyzer-processor", FftAnalyzerProcessor);
