/**
 * WASM Loader for Power Anomaly Detection
 * Manages the lifecycle and memory interface for the C-based sensor module.
 */

export interface PowerAnomalyExports {
  _init_stats: () => void;
  _analyze_power_draw: (currentDraw: number) => number;
  _get_moving_average: () => number;
  _get_sample_count?: () => number;
}

let wasmInstance: PowerAnomalyExports | null = null;
let initPromise: Promise<void> | null = null;
let customWasmInstance: PowerAnomalyExports | null = null;

export interface PowerAnalysisResult {
  status: "NORMAL" | "SPIKE" | "DROP" | "INSUFFICIENT_DATA";
  movingAverage: number;
  rawDraw: number;
  sampleCount?: number;
}

export async function initPowerWasm(): Promise<void> {
  // If already successfully initialized, return immediately
  if (wasmInstance) return;

  // If initialization is already in flight, share the existing promise
  if (initPromise) {
    return initPromise;
  }

  // Create single shared initialization promise for all concurrent callers
  initPromise = (async () => {
    try {
      if (customWasmInstance) {
        wasmInstance = customWasmInstance;
        wasmInstance._init_stats();
        return;
      }

      // Check for compiled WASM binary at /wasm/power_anomaly.wasm or public directory
      let binaryBuffer: ArrayBuffer | null = null;
      if (typeof window !== "undefined" && typeof window.fetch === "function") {
        try {
          const response = await fetch("/wasm/power_anomaly.wasm");
          if (response.ok) {
            binaryBuffer = await response.arrayBuffer();
          }
        } catch {
          // Fetch failed
        }
      } else if (typeof process !== "undefined" && process.versions?.node) {
        try {
          const fs = await import("fs");
          const path = await import("path");
          const wasmPath = path.resolve(
            process.cwd(),
            "public/wasm/power_anomaly.wasm",
          );
          if (fs.existsSync(wasmPath)) {
            binaryBuffer = fs.readFileSync(wasmPath).buffer;
          }
        } catch {
          // Node file read fallback
        }
      }

      if (binaryBuffer) {
        const compiled = await WebAssembly.instantiate(binaryBuffer, {
          env: {
            memory: new WebAssembly.Memory({ initial: 256 }),
            abort: () => console.error("[WASM] Aborted"),
          },
        });
        const exports = compiled.instance.exports as unknown as Record<
          string,
          any
        >;
        wasmInstance = {
          _init_stats: exports._init_stats || exports.init_stats,
          _analyze_power_draw:
            exports._analyze_power_draw || exports.analyze_power_draw,
          _get_moving_average:
            exports._get_moving_average || exports.get_moving_average,
          _get_sample_count:
            exports._get_sample_count || exports.get_sample_count,
        };
        wasmInstance._init_stats();
      } else {
        // Fallback: If compiled WASM binary is not available due to missing toolchain,
        // execute the identical deterministic C rolling-window algorithm (WINDOW_SIZE 20, Z_SCORE 2.5, min 5 samples)
        // rather than randomized mocks.
        const WINDOW_SIZE = 20;
        const Z_SCORE_THRESHOLD = 2.5;
        const buffer = new Float32Array(WINDOW_SIZE);
        let index = 0;
        let count = 0;
        let sum = 0;
        let sq_sum = 0;

        wasmInstance = {
          _init_stats: () => {
            index = 0;
            count = 0;
            sum = 0;
            sq_sum = 0;
            buffer.fill(0);
          },
          _analyze_power_draw: (currentDraw: number) => {
            if (!Number.isFinite(currentDraw) || currentDraw < 0) {
              return -2;
            }
            if (count === WINDOW_SIZE) {
              const oldest = buffer[index];
              sum -= oldest;
              sq_sum -= oldest * oldest;
            } else {
              count++;
            }
            buffer[index] = currentDraw;
            sum += currentDraw;
            sq_sum += currentDraw * currentDraw;
            index = (index + 1) % WINDOW_SIZE;

            if (count < 5) {
              return -1; // Insufficient data
            }

            const mean = sum / count;
            let variance = sq_sum / count - mean * mean;
            if (variance < 0) variance = 0;
            const stdDev = Math.sqrt(variance);

            if (stdDev < 0.001) {
              return 0; // Normal
            }

            const zScore = Math.abs((currentDraw - mean) / stdDev);
            if (zScore > Z_SCORE_THRESHOLD) {
              return currentDraw > mean ? 1 : 2;
            }
            return 0;
          },
          _get_moving_average: () => {
            if (count === 0) return 0;
            return sum / count;
          },
          _get_sample_count: () => count,
        };
        wasmInstance._init_stats();
      }
      console.log("[PowerWasm] Module loaded and initialized successfully.");
    } catch (error) {
      console.error("[PowerWasm] Failed to load WASM module:", error);
      throw new Error("WASM module initialization failed");
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

export function analyzePowerDraw(currentDraw: number): PowerAnalysisResult {
  if (!wasmInstance) {
    throw new Error("WASM module not initialized. Call initPowerWasm() first.");
  }

  // Validate sensor measurement input
  if (
    typeof currentDraw !== "number" ||
    !Number.isFinite(currentDraw) ||
    currentDraw < 0
  ) {
    throw new Error(
      "Invalid power draw reading: must be a non-negative finite number.",
    );
  }

  const resultCode = wasmInstance._analyze_power_draw(currentDraw);
  const movingAvg = wasmInstance._get_moving_average();
  const sampleCount = wasmInstance._get_sample_count?.();

  let status: PowerAnalysisResult["status"] = "NORMAL";
  if (resultCode === 1) status = "SPIKE";
  else if (resultCode === 2) status = "DROP";
  else if (resultCode === -1) status = "INSUFFICIENT_DATA";

  return {
    status,
    movingAverage: Number(movingAvg.toFixed(2)),
    rawDraw: currentDraw,
    sampleCount,
  };
}

export function resetStats(): void {
  if (wasmInstance) {
    wasmInstance._init_stats();
  }
}

export function _resetWasmForTesting(): void {
  wasmInstance = null;
  initPromise = null;
  customWasmInstance = null;
}

export function _setCustomWasmInstanceForTesting(
  instance: PowerAnomalyExports | null,
): void {
  customWasmInstance = instance;
}
