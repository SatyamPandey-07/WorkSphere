import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  createSpatialMaskingHarness,
  processSpatialMasking,
  type SpatialMaskingWasmExports,
} from "@/lib/wasm/spatialMasking";

describe("WASM Spatial Masking Variable Sample Rate FFT Windowing (#5888)", () => {
  let wasm: SpatialMaskingWasmExports;
  const STATE_PTR = 1024;
  const IN_BUF_PTR = 2048;
  const OUT_BUF_PTR = 36864;

  beforeEach(() => {
    // Initialize fresh 256KB WASM linear memory
    wasm = createSpatialMaskingHarness(512 * 1024);
  });

  describe("Dynamic FFT Buffer Dimensioning by Sample Rate & Block Size", () => {
    it("allocates baseline 2048-sample FFT window buffer for 44.1kHz audio", () => {
      const res = wasm.spatial_masking_init(STATE_PTR, 44100, 2048);
      expect(res).toBe(0);

      const stateIdx = STATE_PTR / 4;
      const windowBufPtr = wasm.HEAP32[stateIdx + 0];
      const windowSize = wasm.HEAP32[stateIdx + 3];
      const sampleRate = wasm.HEAP32[stateIdx + 4];

      expect(windowBufPtr).toBeGreaterThan(0);
      expect(windowSize).toBe(2048);
      expect(sampleRate).toBe(44100);

      // Verify Hann window endpoints and midpoint
      const winIdx = windowBufPtr / 4;
      expect(wasm.HEAPF32[winIdx + 0]).toBeCloseTo(0.0, 4);
      expect(wasm.HEAPF32[winIdx + 1024]).toBeCloseTo(1.0, 2);
      expect(wasm.HEAPF32[winIdx + 2047]).toBeCloseTo(0.0, 4);
    });

    it("dynamically dimensions FFT buffer to 4096 samples for 48kHz audio streams with large blocks", () => {
      const res = wasm.spatial_masking_init(STATE_PTR, 48000, 2304);
      expect(res).toBe(0);

      const stateIdx = STATE_PTR / 4;
      const windowBufPtr = wasm.HEAP32[stateIdx + 0];
      const windowSize = wasm.HEAP32[stateIdx + 3];
      const sampleRate = wasm.HEAP32[stateIdx + 4];

      // Block size 2304 exceeds 2048, so next power of 2 is 4096
      expect(windowSize).toBe(4096);
      expect(sampleRate).toBe(48000);

      const winIdx = windowBufPtr / 4;
      expect(wasm.HEAPF32[winIdx + 0]).toBeCloseTo(0.0, 4);
      expect(wasm.HEAPF32[winIdx + 2048]).toBeCloseTo(1.0, 2);
      expect(wasm.HEAPF32[winIdx + 4095]).toBeCloseTo(0.0, 4);
    });

    it("dynamically dimensions FFT buffer to 8192 samples for 96kHz audio streams", () => {
      const res = wasm.spatial_masking_init(STATE_PTR, 96000, 4608);
      expect(res).toBe(0);

      const stateIdx = STATE_PTR / 4;
      const windowSize = wasm.HEAP32[stateIdx + 3];
      const sampleRate = wasm.HEAP32[stateIdx + 4];

      // Block size 4608 at 96kHz expands to 8192
      expect(windowSize).toBe(8192);
      expect(sampleRate).toBe(96000);
    });

    it("automatically re-dimensions buffer capacity via ensure_spatial_masking_capacity when block size grows", () => {
      // Start with 44.1kHz 1024-sample configuration
      wasm.spatial_masking_init(STATE_PTR, 44100, 1024);
      const stateIdx = STATE_PTR / 4;
      expect(wasm.HEAP32[stateIdx + 3]).toBe(1024);

      // Now audio stream switches to 96kHz with 4096 samples
      const ensureRes = wasm.ensure_spatial_masking_capacity(STATE_PTR, 96000, 4096);
      expect(ensureRes).toBe(0);
      expect(wasm.HEAP32[stateIdx + 3]).toBe(4096);
      expect(wasm.HEAP32[stateIdx + 4]).toBe(96000);
    });
  });

  describe("Bounds Checking Before Executing Windowing Dot-Product", () => {
    it("rejects invalid or null pointers with -1 before executing dot-product", () => {
      const windowBufPtr = wasm.wasm_malloc(1024 * 4);
      wasm.init_hann_window(windowBufPtr, 1024);

      // Null input pointer
      expect(wasm.apply_hann_window(0, OUT_BUF_PTR, 512, windowBufPtr, 1024)).toBe(-1);
      // Null output pointer
      expect(wasm.apply_hann_window(IN_BUF_PTR, 0, 512, windowBufPtr, 1024)).toBe(-1);
      // Null window pointer
      expect(wasm.apply_hann_window(IN_BUF_PTR, OUT_BUF_PTR, 512, 0, 1024)).toBe(-1);
      // Non-positive sample count
      expect(wasm.apply_hann_window(IN_BUF_PTR, OUT_BUF_PTR, 0, windowBufPtr, 1024)).toBe(-1);
      expect(wasm.apply_hann_window(IN_BUF_PTR, OUT_BUF_PTR, -5, windowBufPtr, 1024)).toBe(-1);
    });

    it("enforces strict bounds clamping so input blocks never overrun the window buffer", () => {
      const windowSize = 512;
      const windowBufPtr = wasm.wasm_malloc(windowSize * 4);
      wasm.init_hann_window(windowBufPtr, windowSize);

      const inPtr = wasm.wasm_malloc(1024 * 4);
      const outPtr = wasm.wasm_malloc(1024 * 4);

      // Setup canary values after the 512-sample boundary in output buffer
      const CANARY = 999.0;
      wasm.HEAPF32[outPtr / 4 + 512] = CANARY;
      wasm.HEAPF32[outPtr / 4 + 513] = CANARY;

      // Fill input with 1.0
      for (let i = 0; i < 1024; i++) {
        wasm.HEAPF32[inPtr / 4 + i] = 1.0;
      }

      // Request 1024 samples when window buffer is only 512 samples
      const processed = wasm.apply_hann_window(
        inPtr,
        outPtr,
        1024,
        windowBufPtr,
        windowSize,
      );

      // Must clamp to windowSize (512) and not overrun into sample 512 or beyond
      expect(processed).toBe(512);
      expect(wasm.HEAPF32[outPtr / 4 + 512]).toBe(CANARY);
      expect(wasm.HEAPF32[outPtr / 4 + 513]).toBe(CANARY);

      // Validated that output within bounds received the Hann window values
      expect(wasm.HEAPF32[outPtr / 4 + 256]).toBeCloseTo(1.0, 2);
    });
  });

  describe("Multi-Channel Audio Buffer Filtering at 48kHz and 96kHz", () => {
    it("processes 48kHz stereo (2-channel) audio buffer with 2048-sample blocks without memory corruption", () => {
      const sampleRate = 48000;
      const numChannels = 2;
      const numSamples = 2048;

      wasm.spatial_masking_init(STATE_PTR, sampleRate, numSamples);

      const inChPointersPtr = wasm.wasm_malloc(numChannels * 4);
      const outChPointersPtr = wasm.wasm_malloc(numChannels * 4);

      const outChPointers: number[] = [];

      for (let ch = 0; ch < numChannels; ch++) {
        const inChPtr = wasm.wasm_malloc(numSamples * 4);
        const outChPtr = wasm.wasm_malloc(numSamples * 4);

        // Fill channel with alternating sine wave
        for (let i = 0; i < numSamples; i++) {
          wasm.HEAPF32[inChPtr / 4 + i] = Math.sin((i * (ch + 1) * Math.PI) / 64);
        }

        wasm.HEAP32[inChPointersPtr / 4 + ch] = inChPtr;
        wasm.HEAP32[outChPointersPtr / 4 + ch] = outChPtr;
        outChPointers.push(outChPtr);
      }

      const status = wasm.process_spatial_masking_multichannel(
        STATE_PTR,
        inChPointersPtr,
        outChPointersPtr,
        numChannels,
        numSamples,
        sampleRate,
        0.5,
        12345,
      );

      expect(status).toBe(0);

      // Verify all samples are non-NaN, bounded in [-1.0, 1.0], and processed
      for (let ch = 0; ch < numChannels; ch++) {
        const outPtr = outChPointers[ch];
        for (let i = 0; i < numSamples; i++) {
          const val = wasm.HEAPF32[outPtr / 4 + i];
          expect(Number.isNaN(val)).toBe(false);
          expect(val).toBeGreaterThanOrEqual(-1.0);
          expect(val).toBeLessThanOrEqual(1.0);
        }
      }
    });

    it("processes 48kHz 4-channel microphone array with block size exceeding 2048 (2304 samples)", () => {
      const sampleRate = 48000;
      const numChannels = 4;
      const numSamples = 2304; // Exceeds fixed 2048 baseline

      wasm.spatial_masking_init(STATE_PTR, sampleRate, numSamples);

      const inChPointersPtr = wasm.wasm_malloc(numChannels * 4);
      const outChPointersPtr = wasm.wasm_malloc(numChannels * 4);

      for (let ch = 0; ch < numChannels; ch++) {
        const inChPtr = wasm.wasm_malloc(numSamples * 4);
        const outChPtr = wasm.wasm_malloc(numSamples * 4);

        for (let i = 0; i < numSamples; i++) {
          wasm.HEAPF32[inChPtr / 4 + i] = 0.5 * Math.cos((i * Math.PI) / 128);
        }

        wasm.HEAP32[inChPointersPtr / 4 + ch] = inChPtr;
        wasm.HEAP32[outChPointersPtr / 4 + ch] = outChPtr;
      }

      const status = wasm.process_spatial_masking_multichannel(
        STATE_PTR,
        inChPointersPtr,
        outChPointersPtr,
        numChannels,
        numSamples,
        sampleRate,
        0.75,
        42,
      );

      expect(status).toBe(0);
    });

    it("processes 96kHz multi-channel buffers with 4096-sample blocks cleanly without buffer overruns", () => {
      const sampleRate = 96000;
      const numChannels = 4;
      const numSamples = 4096;

      const channels: Float32Array[] = [];
      for (let ch = 0; ch < numChannels; ch++) {
        const channel = new Float32Array(numSamples);
        for (let i = 0; i < numSamples; i++) {
          channel[i] = 0.6 * Math.sin((i * (ch + 1) * 2 * Math.PI) / 96000);
        }
        channels.push(channel);
      }

      const outputChannels = processSpatialMasking(channels, {
        sampleRate,
        blockSize: numSamples,
        maskIntensity: 0.6,
      });

      expect(outputChannels.length).toBe(numChannels);
      for (let ch = 0; ch < numChannels; ch++) {
        expect(outputChannels[ch].length).toBe(numSamples);

        for (let i = 0; i < numSamples; i++) {
          const val = outputChannels[ch][i];
          expect(Number.isNaN(val)).toBe(false);
          expect(val).toBeGreaterThanOrEqual(-1.0);
          expect(val).toBeLessThanOrEqual(1.0);
        }
      }
    });

    it("processes 96kHz 2-channel stereo with large 4608-sample blocks via dynamic chunking", () => {
      const sampleRate = 96000;
      const numSamples = 4608;

      const channels: Float32Array[] = [
        new Float32Array(numSamples).fill(0.3),
        new Float32Array(numSamples).fill(-0.3),
      ];

      const outputChannels = processSpatialMasking(channels, {
        sampleRate,
        blockSize: numSamples,
        maskIntensity: 0.4,
      });

      expect(outputChannels.length).toBe(2);
      expect(outputChannels[0].length).toBe(4608);
      expect(outputChannels[1].length).toBe(4608);
    });
  });
});
