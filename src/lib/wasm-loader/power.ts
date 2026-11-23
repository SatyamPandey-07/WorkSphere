/**
 * WASM Loader for Power Anomaly Detection
 * Manages the lifecycle and memory interface for the C-based sensor module.
 * Provides explicit deallocation and lifecycle cleanup to prevent memory leaks on unmount (#9634).
 */


let wasmInstance: any = null;
let wasmMemory: WebAssembly.Memory | null = null;
let isInitializing = false;
let initPromise: Promise<void> | null = null;

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

}

export function isPowerWasmReady(): boolean {
  return wasmInstance !== null;
}

export function isPowerWasmInitializing(): boolean {
  return isInitializing;
}

export function getPowerWasmInstance(): any {
  return wasmInstance;
}

export function getPowerWasmMemory(): WebAssembly.Memory | null {
  return wasmMemory;
}

export async function initPowerWasm(
  customInstance?: any,
  customMemory?: WebAssembly.Memory,
): Promise<void> {
  if (wasmInstance) return;
  if (isInitializing && initPromise) return initPromise;

  isInitializing = true;
  initPromise = (async () => {
    try {
      if (customInstance) {
        wasmInstance = customInstance;
        wasmMemory =
          customMemory ||
          (typeof WebAssembly !== "undefined"
            ? new WebAssembly.Memory({ initial: 256 })
            : null);
        if (typeof wasmInstance._init_stats === "function") {
          wasmInstance._init_stats();
        }
        console.log(
          "[PowerWasm] Module loaded and initialized successfully with custom instance.",
        );
        return;
      }

      // In a real Next.js app, this would use next/dynamic or a fetch to the public WASM file
      // For this implementation, we assume a mock or bundled WASM loader pattern
      try {
        await import("@/wasm/sensors/power_anomaly.wasm");
      } catch {
        // Fallback for environments where the .wasm file is not bundler-resolvable
      }

      if (typeof WebAssembly !== "undefined") {
        try {
          wasmMemory = customMemory || new WebAssembly.Memory({ initial: 256 });
        } catch {
          wasmMemory = null;
        }
      }

      // Moving statistics buffer mirroring power_anomaly.c (WINDOW_SIZE = 20, Z_SCORE_THRESHOLD = 2.5)
      const WINDOW_SIZE = 20;
      const Z_SCORE_THRESHOLD = 2.5;
      let count = 0;
      let sum = 0.0;
      let sqSum = 0.0;
      let buffer = new Float32Array(WINDOW_SIZE);
      let index = 0;

      // Mocking the Emscripten glue code instantiation
      // In production, you'd use the generated `power_anomaly.js` glue code
      wasmInstance = {
        _init_stats: () => {
          count = 0;
          sum = 0.0;
          sqSum = 0.0;
          index = 0;
          buffer.fill(0);
          console.log("[WASM] Stats Initialized");
        },
        _analyze_power_draw: (currentDraw: number) => {
          if (count === WINDOW_SIZE) {
            const oldest = buffer[index];
            sum -= oldest;
            sqSum -= oldest * oldest;
          } else {
            count++;
          }

          buffer[index] = currentDraw;
          sum += currentDraw;
          sqSum += currentDraw * currentDraw;
          index = (index + 1) % WINDOW_SIZE;

          if (count < 5) {
            return 0; // Normal / insufficient data
          }

          const mean = sum / count;
          let variance = sqSum / count - mean * mean;
          if (variance < 0.0) variance = 0.0;

          const stdDev = Math.sqrt(variance);
          if (stdDev < 0.001) {
            return 0;
          }

          const zScore = Math.abs((currentDraw - mean) / stdDev);
          if (zScore > Z_SCORE_THRESHOLD) {
            return currentDraw > mean ? 1 : 2; // 1 = SPIKE, 2 = DROP
          }

          return 0; // Normal
        },
        _get_moving_average: () => {
          if (count === 0) return 0.0;
          return sum / count;
        },
        _cleanup: () => {
          buffer = new Float32Array(0);
          count = 0;
          sum = 0.0;
          sqSum = 0.0;
          index = 0;
          console.log("[WASM] Stats Cleaned Up");
        },
      };

      // Call C initialization
      wasmInstance._init_stats();

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

      isInitializing = false;

      initPromise = null;

    }
  })();

  return initPromise;
}

export function analyzePowerDraw(currentDraw: number): PowerAnalysisResult {
  if (!wasmInstance) {
    throw new Error("WASM module not initialized. Call initPowerWasm() first.");
  }


  const resultCode = wasmInstance._analyze_power_draw(currentDraw);
  const movingAvg = wasmInstance._get_moving_average();


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

    movingAverage: movingAvg,
    rawDraw: currentDraw,

    movingAverage: Number(movingAvg.toFixed(2)),
    rawDraw: currentDraw,
    sampleCount,

  };
}

export function resetStats(): void {

  if (wasmInstance && typeof wasmInstance._init_stats === "function") {

  if (wasmInstance) {

    wasmInstance._init_stats();
  }
}


/**
 * Explicitly cleans up and deallocates the WASM instance, memory buffers,
 * and resets initialization flags to prevent memory leaks on unmount (#9634).
 */
export function cleanupPowerWasm(): void {
  if (wasmInstance) {
    if (typeof wasmInstance._cleanup === "function") {
      try {
        wasmInstance._cleanup();
      } catch (err) {
        console.warn("[PowerWasm] Error during instance _cleanup:", err);
      }
    }
    wasmInstance = null;
  }
  wasmMemory = null;
  isInitializing = false;
  initPromise = null;
  console.log("[PowerWasm] Module cleaned up and memory references released.");
}

/**
 * Class-based lifecycle loader for Power Telemetry WASM & Web Worker.
 * Ensures clean termination, buffer detachment, and garbage collection on teardown.
 */
export class PowerTelemetryLoader {
  private worker: Worker | null = null;
  private createWorker?: () => Worker;
  private isReady: boolean = false;
  private sharedBuffer: SharedArrayBuffer | ArrayBuffer | null = null;

  constructor(worker?: Worker, createWorker?: () => Worker) {
    if (worker) {
      this.worker = worker;
      this.isReady = true;
    } else {
      this.createWorker = createWorker;
    }
  }

  public async initialize(createWorker?: () => Worker): Promise<void> {
    if (this.isReady && (this.worker || isPowerWasmReady())) return;

    const factory = createWorker || this.createWorker;
    if (factory) {
      this.worker = factory();
      await new Promise<void>((resolve, reject) => {
        if (!this.worker) return resolve();
        const onMessage = (e: MessageEvent) => {
          if (e.data?.type === "INIT_SUCCESS") {
            this.isReady = true;
            this.worker?.removeEventListener("message", onMessage);
            resolve();
          } else if (e.data?.type === "INIT_ERROR") {
            this.worker?.removeEventListener("message", onMessage);
            reject(new Error(e.data?.error || "Worker init failed"));
          }
        };
        this.worker.addEventListener("message", onMessage);
        this.worker.postMessage({ type: "INIT" });
      });
    } else if (typeof Worker !== "undefined") {
      try {
        const { createPowerWorker } = await import("./createPowerWorker");
        this.worker = createPowerWorker();
      } catch {
        await initPowerWasm();
        this.isReady = true;
        return;
      }
      await new Promise<void>((resolve, reject) => {
        if (!this.worker) return resolve();
        const onMessage = (e: MessageEvent) => {
          if (e.data?.type === "INIT_SUCCESS") {
            this.isReady = true;
            this.worker?.removeEventListener("message", onMessage);
            resolve();
          } else if (e.data?.type === "INIT_ERROR") {
            this.worker?.removeEventListener("message", onMessage);
            reject(new Error(e.data?.error || "Worker init failed"));
          }
        };
        this.worker.addEventListener("message", onMessage);
        this.worker.postMessage({ type: "INIT" });
      });
    } else {
      await initPowerWasm();
      this.isReady = true;
    }
  }

  public setSharedBuffer(buffer: SharedArrayBuffer | ArrayBuffer): void {
    this.sharedBuffer = buffer;
    if (this.worker) {
      this.worker.postMessage({
        type: "INIT",
        payload: { sharedBuffer: buffer },
      });
    }
  }

  public getSharedBuffer(): SharedArrayBuffer | ArrayBuffer | null {
    return this.sharedBuffer;
  }

  public getWorker(): Worker | null {
    return this.worker;
  }

  public isInitialized(): boolean {
    return this.isReady;
  }

  public analyzePowerDraw(draw: number): PowerAnalysisResult {
    return analyzePowerDraw(draw);
  }

  public terminate(): void {
    if (this.worker) {
      try {
        this.worker.postMessage({ type: "TERMINATE" });
      } catch {
        // Ignore errors if worker already closed
      }
      try {
        this.worker.onmessage = null;
        this.worker.onerror = null;
        this.worker.terminate();
      } catch {
        // Ignore termination errors
      }
      this.worker = null;
    }
    cleanupPowerWasm();
    this.sharedBuffer = null;
    this.isReady = false;
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
