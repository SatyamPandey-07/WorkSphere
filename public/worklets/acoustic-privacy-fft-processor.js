/**
 * acoustic-privacy-fft-processor.js
 *
 * Dedicated AudioWorklet processor for Real-Time Acoustic Privacy Analysis (#7630).
 * Accumulates 2048-point frames from microphone input, applies Hann windowing,
 * performs WebAssembly SIMD accelerated 2048-point FFT, and delivers frequency-bin
 * decibel arrays via SharedArrayBuffer (when available) or transferable postMessage.
 */

const FFT_SIZE = 2048;
const HALF_FFT_SIZE = 1024;

class AcousticPrivacyFftProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);
    this._fftSize = options?.processorOptions?.fftSize || FFT_SIZE;
    this._sampleRate =
      options?.processorOptions?.sampleRate ||
      (typeof sampleRate !== "undefined" ? sampleRate : 48000);

    // Preallocated ring buffer for 2048 samples
    this._ringBuffer = new Float32Array(this._fftSize);
    this._writeOffset = 0;

    // Precomputed Hann window
    this._hannWindow = new Float32Array(this._fftSize);
    for (let i = 0; i < this._fftSize; i++) {
      this._hannWindow[i] =
        0.5 * (1.0 - Math.cos((2.0 * Math.PI * i) / (this._fftSize - 1)));
    }

    // Precomputed bit-reversal table
    this._bitRev = new Uint16Array(this._fftSize);
    const bits = Math.round(Math.log2(this._fftSize));
    for (let i = 0; i < this._fftSize; i++) {
      let rev = 0;
      let n = i;
      for (let b = 0; b < bits; b++) {
        rev = (rev << 1) | (n & 1);
        n >>= 1;
      }
      this._bitRev[i] = rev;
    }

    // Precomputed twiddle factors
    const half = this._fftSize / 2;
    this._cosTable = new Float32Array(half);
    this._sinTable = new Float32Array(half);
    for (let i = 0; i < half; i++) {
      const angle = (-2.0 * Math.PI * i) / this._fftSize;
      this._cosTable[i] = Math.cos(angle);
      this._sinTable[i] = Math.sin(angle);
    }

    // Preallocated working buffers
    this._realBuf = new Float32Array(this._fftSize);
    this._imagBuf = new Float32Array(this._fftSize);
    this._dbBuf = new Float32Array(HALF_FFT_SIZE);

    // SharedArrayBuffer support
    this._sharedDbBuffer = null;
    this._useSharedArrayBuffer = false;

    // WASM instance
    this._wasm = null;
    this._wasmF32 = null;
    this._wasmReady = false;

    this.port.onmessage = async (event) => {
      const { type, wasmBytes, wasmModule, sharedBuffer } = event.data || {};
      if (type === "INIT_WASM") {
        await this._initWasm(wasmModule || wasmBytes);
      } else if (type === "SET_SHARED_BUFFER" && sharedBuffer) {
        try {
          this._sharedDbBuffer = new Float32Array(sharedBuffer);
          this._useSharedArrayBuffer = true;
        } catch {
          this._useSharedArrayBuffer = false;
        }
      }
    };
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
      this._wasmF32 = new Float32Array(this._wasm.memory.buffer);

      const hannPtr = this._wasm.getHannPtr ? this._wasm.getHannPtr() : 28672;
      this._wasmF32.set(this._hannWindow, hannPtr >> 2);
      this._wasmReady = true;
      this.port.postMessage({ type: "WASM_READY", isSimd: true });
    } catch (err) {
      this._wasmReady = false;
      this.port.postMessage({
        type: "WASM_ERROR",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  _computeFft() {
    const n = this._fftSize;
    const half = n >> 1;

    // Fast-path: WASM SIMD execution
    if (this._wasmReady && this._wasm && this._wasmF32) {
      const inPtr = this._wasm.getInputPtr();
      const realPtr = this._wasm.getRealPtr();
      const imagPtr = this._wasm.getImagPtr();
      const winPtr = this._wasm.getHannPtr();
      const inOffset = inPtr >> 2;
      const realBase = realPtr >> 2;
      const imagBase = imagPtr >> 2;

      this._wasmF32.set(this._ringBuffer, inOffset);
      this._wasm.applyWindowSimd(inPtr, winPtr, realPtr, imagPtr, n);

      for (let i = 0; i < n; i++) {
        this._realBuf[i] = this._wasmF32[realBase + this._bitRev[i]];
        this._imagBuf[i] = 0.0;
      }
      this._wasmF32.set(this._realBuf, realBase);
      this._wasmF32.set(this._imagBuf, imagBase);

      const scratchWrPtr = winPtr + 8192;
      const scratchWiPtr = winPtr + 12288;
      const wrBase = scratchWrPtr >> 2;
      const wiBase = scratchWiPtr >> 2;

      for (let len = 2; len <= n; len <<= 1) {
        const halfLen = len >> 1;
        const step = n / len;

        for (let i = 0; i < n; i += len) {
          if (halfLen >= 4 && this._wasm.fftButterflySimd) {
            for (let k = 0; k < halfLen; k++) {
              const twIdx = k * step;
              this._wasmF32[wrBase + k] = this._cosTable[twIdx];
              this._wasmF32[wiBase + k] = this._sinTable[twIdx];
            }
            this._wasm.fftButterflySimd(
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
              const wr = this._cosTable[twIdx];
              const wi = this._sinTable[twIdx];

              const u = i + k;
              const v = u + halfLen;

              const ur = this._wasmF32[realBase + u];
              const ui = this._wasmF32[imagBase + u];
              const vr = this._wasmF32[realBase + v];
              const vi = this._wasmF32[imagBase + v];

              const tr = vr * wr - vi * wi;
              const ti = vr * wi + vi * wr;

              this._wasmF32[realBase + u] = ur + tr;
              this._wasmF32[imagBase + u] = ui + ti;
              this._wasmF32[realBase + v] = ur - tr;
              this._wasmF32[imagBase + v] = ui - ti;
            }
          }
        }
      }

      this._realBuf.set(this._wasmF32.subarray(realBase, realBase + n));
      this._imagBuf.set(this._wasmF32.subarray(imagBase, imagBase + n));
    } else {
      // Scalar Fallback execution
      for (let i = 0; i < n; i++) {
        const val = Number.isFinite(this._ringBuffer[i]) ? this._ringBuffer[i] : 0.0;
        this._realBuf[i] = val * this._hannWindow[i];
        this._imagBuf[i] = 0.0;
      }

      for (let i = 0; i < n; i++) {
        const j = this._bitRev[i];
        if (i < j) {
          const tr = this._realBuf[i];
          this._realBuf[i] = this._realBuf[j];
          this._realBuf[j] = tr;

          const ti = this._imagBuf[i];
          this._imagBuf[i] = this._imagBuf[j];
          this._imagBuf[j] = ti;
        }
      }

      for (let len = 2; len <= n; len <<= 1) {
        const halfLen = len >> 1;
        const step = n / len;

        for (let i = 0; i < n; i += len) {
          for (let k = 0; k < halfLen; k++) {
            const twIdx = k * step;
            const wr = this._cosTable[twIdx];
            const wi = this._sinTable[twIdx];

            const u = i + k;
            const v = u + halfLen;

            const ur = this._realBuf[u];
            const ui = this._imagBuf[u];
            const vr = this._realBuf[v];
            const vi = this._imagBuf[v];

            const tr = vr * wr - vi * wi;
            const ti = vr * wi + vi * wr;

            this._realBuf[u] = ur + tr;
            this._imagBuf[u] = ui + ti;
            this._realBuf[v] = ur - tr;
            this._imagBuf[v] = ui - ti;
          }
        }
      }
    }

    // Magnitude and Decibels computation
    const scale = 2.0 / n;
    const eps = 1e-12;
    let maxDb = -100.0;
    let peakBin = 0;

    for (let b = 0; b < half; b++) {
      const r = Number.isFinite(this._realBuf[b]) ? this._realBuf[b] : 0.0;
      const im = Number.isFinite(this._imagBuf[b]) ? this._imagBuf[b] : 0.0;
      const mag = Math.sqrt(r * r + im * im) * scale;
      const safeMag = mag > eps ? mag : eps;
      let val = 20.0 * Math.log10(safeMag);

      if (!Number.isFinite(val) || val < -100.0) {
        val = -100.0;
      } else if (val > 20.0) {
        val = 20.0;
      }

      this._dbBuf[b] = val;
      if (b > 0 && val > maxDb) {
        maxDb = val;
        peakBin = b;
      }
    }

    const dominantFrequencyHz = (peakBin * this._sampleRate) / n;
    return {
      peakDb: maxDb,
      dominantFrequencyHz,
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    // Pass-through audio cleanly without blocking rendering
    if (input && input[0] && output && output[0]) {
      output[0].set(input[0]);
    }

    if (!input || !input[0] || input[0].length === 0) {
      return true;
    }

    const samples = input[0];
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();

    for (let i = 0; i < samples.length; i++) {
      this._ringBuffer[this._writeOffset++] = samples[i];
      if (this._writeOffset >= this._fftSize) {
        this._writeOffset = 0;

        const metrics = this._computeFft();
        const latencyMs =
          (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;

        // Transport: SharedArrayBuffer when available, postMessage transferable buffer otherwise
        if (this._useSharedArrayBuffer && this._sharedDbBuffer) {
          this._sharedDbBuffer.set(this._dbBuf);
          this.port.postMessage({
            type: "FFT_FRAME",
            shared: true,
            peakDb: metrics.peakDb,
            dominantFrequencyHz: metrics.dominantFrequencyHz,
            latencyMs,
          });
        } else {
          // Transferable copy
          const transferBuf = new Float32Array(this._dbBuf);
          this.port.postMessage(
            {
              type: "FFT_FRAME",
              shared: false,
              decibels: transferBuf,
              peakDb: metrics.peakDb,
              dominantFrequencyHz: metrics.dominantFrequencyHz,
              latencyMs,
            },
            [transferBuf.buffer],
          );
        }
      }
    }

    return true;
  }
}

registerProcessor("acoustic-privacy-fft-processor", AcousticPrivacyFftProcessor);
