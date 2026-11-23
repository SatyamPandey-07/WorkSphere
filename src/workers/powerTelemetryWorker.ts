/**
 * Power Telemetry Worker
 * Streams IoT sensor data, passes it to the WASM anomaly detector,
 * and posts alerts back to the main thread.
 * Equipped with cleanup and buffer deallocation lifecycle routines (#9634).
 */

import {
  initPowerWasm,
  analyzePowerDraw,

  cleanupPowerWasm,
  resetStats,
  type PowerAnalysisResult,

  resetStats,
  PowerAnalysisResult,

} from "@/lib/wasm-loader/power";

let isWasmReady = false;
let sharedBufferRef: SharedArrayBuffer | ArrayBuffer | Float32Array | null =
  null;


export const handleWorkerMessage = async (event: MessageEvent) => {

self.addEventListener("message", async (event: MessageEvent) => {

  const { type, payload } = event.data || {};

  if (type === "INIT") {
    try {
      await initPowerWasm();
      isWasmReady = true;

      if (payload?.sharedBuffer) {
        sharedBufferRef = payload.sharedBuffer;
      }
      if (typeof self.postMessage === "function") {
        self.postMessage({ type: "INIT_SUCCESS" });
      }
    } catch (err: any) {
      if (typeof self.postMessage === "function") {
        self.postMessage({
          type: "INIT_ERROR",
          error: err?.message || String(err),
        });
      }

      self.postMessage({ type: "INIT_SUCCESS" });
    } catch (err: any) {
      self.postMessage({ type: "INIT_ERROR", error: err.message });

    }
    return;
  }


  if (type === "SET_BUFFER") {
    if (payload?.sharedBuffer) {
      sharedBufferRef = payload.sharedBuffer;
      if (typeof self.postMessage === "function") {
        self.postMessage({ type: "BUFFER_SET_SUCCESS" });
      }
    }
    return;
  }

  if (type === "TELEMETRY_STREAM") {
    if (!isWasmReady) {
      if (typeof self.postMessage === "function") {
        self.postMessage({
          type: "ERROR",
          error: "WASM not ready for stream processing.",
        });
      }
      return;
    }

    const { outletId, drawValue, timestamp } = payload || {};

    try {
      const result: PowerAnalysisResult = analyzePowerDraw(drawValue);

      if (result.status === "SPIKE" || result.status === "DROP") {
        if (typeof self.postMessage === "function") {
          self.postMessage({
            type: "ANOMALY_DETECTED",
            payload: {
              outletId,
              timestamp,
              ...result,
            },
          });
        }
      } else {
        // Optional: Send periodic health checks even if normal
        if (Math.random() < 0.01) {
          // 1% sampling for normal logs to reduce noise
          if (typeof self.postMessage === "function") {
            self.postMessage({
              type: "HEALTH_CHECK",
              payload: {
                outletId,
                status: "NORMAL",
                movingAverage: result.movingAverage,
              },
            });
          }
        }
      }
    } catch (err: any) {
      if (typeof self.postMessage === "function") {
        self.postMessage({
          type: "PROCESSING_ERROR",
          outletId,
          error: err?.message || String(err),
        });
      }
    }
    return;
  }

  if (type === "RESET") {
    resetStats();
    if (typeof self.postMessage === "function") {
      self.postMessage({ type: "RESET_COMPLETE" });

  if (type === "TELEMETRY_STREAM") {
    if (!isWasmReady) {
      self.postMessage({
        type: "ERROR",
        error: "WASM not ready for stream processing.",
      });
      return;
    }

    const { outletId, drawValue, timestamp } = payload || {};

    if (
      typeof drawValue !== "number" ||
      !Number.isFinite(drawValue) ||
      drawValue < 0
    ) {
      self.postMessage({
        type: "PROCESSING_ERROR",
        outletId,
        error:
          "Invalid power draw reading: must be a non-negative finite number.",
      });
      return;
    }

    try {
      const result: PowerAnalysisResult = analyzePowerDraw(drawValue);

      if (result.status === "SPIKE" || result.status === "DROP") {
        self.postMessage({
          type: "ANOMALY_DETECTED",
          payload: {
            outletId,
            timestamp,
            ...result,
          },
        });
      } else {
        // Optional: Send periodic health checks even if normal
        if (Math.random() < 0.01) {
          // 1% sampling for normal logs to reduce noise
          self.postMessage({
            type: "HEALTH_CHECK",
            payload: {
              outletId,
              status: "NORMAL",
              movingAverage: result.movingAverage,
            },
          });
        }
      }
    } catch (err: any) {
      self.postMessage({
        type: "PROCESSING_ERROR",
        outletId,
        error: err.message,
      });

    }
    return;
  }


  if (type === "TERMINATE" || type === "CLEANUP") {
    try {
      cleanupPowerWasm();
      isWasmReady = false;
      sharedBufferRef = null;
      if (typeof self.removeEventListener === "function") {
        self.removeEventListener("message", handleWorkerMessage);
      }
      if (typeof self.postMessage === "function") {
        self.postMessage({ type: "CLEANUP_SUCCESS" });
      }
    } catch (err: any) {
      if (typeof self.postMessage === "function") {
        self.postMessage({
          type: "CLEANUP_ERROR",
          error: err?.message || String(err),
        });
      }
    } finally {
      if (typeof self.close === "function") {
        self.close();
      }
    }
    return;
  }
};

if (
  typeof self !== "undefined" &&
  typeof self.addEventListener === "function"
) {
  self.addEventListener("message", handleWorkerMessage);

  // Handle worker termination
  self.addEventListener("unload", () => {
    console.log("[PowerWorker] Terminating...");
    cleanupPowerWasm();
    isWasmReady = false;
    sharedBufferRef = null;
  });
}

export function cleanupWorkerListeners() {
  if (
    typeof self !== "undefined" &&
    typeof self.removeEventListener === "function"
  ) {
    self.removeEventListener("message", handleWorkerMessage);
  }
}

export function getWorkerState() {
  return {
    isWasmReady,
    hasSharedBuffer: sharedBufferRef !== null,
  };
}

export { isWasmReady, sharedBufferRef };

  if (type === "RESET") {
    resetStats();
    self.postMessage({ type: "RESET_COMPLETE" });
    return;
  }
});

// Handle worker termination
self.addEventListener("unload", () => {
  console.log("[PowerWorker] Terminating...");
});

export {};

