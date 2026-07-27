/**
 * noiseWorker.ts
 *
 * Dedicated Web Worker for offloading WebAssembly-accelerated noise calculation & FFT processing
 * from the main UI thread. Gracefully falls back to pure JS processing on unsupported or low-power devices.
 */

import {
  loadNoiseFFTWasm,
  processAudioNoiseFrame,
  benchmarkNoiseEngine,
  isWasmLoaded,
} from "@/lib/wasm/noiseFFT";

export interface NoiseWorkerMessage {
  id: string;
  type: "PROCESS_AUDIO" | "RUN_BENCHMARK" | "GET_STATUS";
  samples?: Float32Array;
  sampleRate?: number;
  fftSize?: number;
  iterations?: number;
}

// Start loading WASM asynchronously in worker thread
loadNoiseFFTWasm().catch((err) => {
  console.warn(
    "[noiseWorker] WebAssembly failed to load inside worker, JS fallback ready:",
    err,
  );
});

self.onmessage = async (e: MessageEvent<NoiseWorkerMessage>) => {
  const { id, type, samples, fftSize = 512, iterations = 50 } = e.data;

  try {
    switch (type) {
      case "PROCESS_AUDIO": {
        if (!samples || samples.length === 0) {
          self.postMessage({
            id,
            type: "AUDIO_PROCESSED",
            rms: 0,
            averageDb: 20,
            peakDb: 20,
            spectrum: new Float32Array(0),
            mode: "javascript",
            executionTimeMs: 0,
          });
          return;
        }

        const result = await processAudioNoiseFrame(samples, fftSize);
        self.postMessage({
          id,
          type: "AUDIO_PROCESSED",
          ...result,
        });
        break;
      }

      case "RUN_BENCHMARK": {
        const testSamples =
          samples && samples.length > 0
            ? samples
            : new Float32Array(1024).map((_, i) => Math.sin(i * 0.1));

        const benchmarkResult = await benchmarkNoiseEngine(
          testSamples,
          iterations,
        );
        self.postMessage({
          id,
          type: "BENCHMARK_COMPLETE",
          result: benchmarkResult,
        });
        break;
      }

      case "GET_STATUS": {
        const wasmLoaded = isWasmLoaded();
        self.postMessage({
          id,
          type: "STATUS_RESPONSE",
          wasmLoaded,
          isFallback: !wasmLoaded,
        });
        break;
      }

      default: {
        self.postMessage({
          id,
          type: "ERROR",
          error: `Unknown message type: ${type}`,
        });
      }
    }
  } catch (error) {
    self.postMessage({
      id,
      type: "ERROR",
      error:
        (error as Error).message || "An error occurred during audio processing",
    });
  }
};
