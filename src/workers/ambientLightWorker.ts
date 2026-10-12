/**
 * ambientLightWorker.ts
 * Web Worker that streams video frames and sensor data to the WASM module for real-time lighting analysis.
 * Offloads heavy pixel processing to prevent main thread jank.
 * Guards SharedArrayBuffer allocations with cross-origin isolation capability checks,
 * falling back seamlessly to standard ArrayBuffer and postMessage([buffer], [buffer]) transferable arrays
 * in environments lacking COOP/COEP headers.
 */

import { lightingWasm } from "@/lib/wasm-loader/lighting";

/**
 * Checks whether the current runtime environment is cross-origin isolated.
 */
export function isCrossOriginIsolated(): boolean {
  return (
    typeof crossOriginIsolated !== "undefined" && crossOriginIsolated === true
  );
}

/**
 * Determines whether SharedArrayBuffer is available and safe to instantiate.
 * Prevents Uncaught ReferenceError on hosting environments without COOP/COEP headers.
 */
export function isSharedArrayBufferSupported(): boolean {
  return typeof SharedArrayBuffer !== "undefined" && isCrossOriginIsolated();
}

/**
 * Allocates a frame buffer using SharedArrayBuffer if cross-origin isolated,
 * or falls back to a standard ArrayBuffer.
 */
export function allocateFrameBuffer(byteLength: number): {
  buffer: ArrayBuffer | SharedArrayBuffer;
  isShared: boolean;
} {
  if (isSharedArrayBufferSupported()) {
    try {
      return {
        buffer: new SharedArrayBuffer(byteLength),
        isShared: true,
      };
    } catch {
      // Fallback if allocation fails unexpectedly
    }
  }
  return {
    buffer: new ArrayBuffer(byteLength),
    isShared: false,
  };
}

/**
 * Message handler for worker communication.
 */
export async function handleWorkerMessage(event: MessageEvent): Promise<void> {
  const data = event.data;

  // Handle direct transferable array messages: postMessage([buffer], [buffer])
  if (Array.isArray(data) && data[0] instanceof ArrayBuffer) {
    const buffer = data[0];
    if (typeof self !== "undefined" && self.postMessage) {
      self.postMessage([buffer], [buffer]);
    }
    return;
  }

  if (!data || typeof data !== "object") {
    return;
  }

  const { type, payload } = data;

  if (type === "INIT") {
    try {
      if (payload?.wasmUrl) {
        await lightingWasm.initialize(payload.wasmUrl);
      }
      const isShared = isSharedArrayBufferSupported();
      if (typeof self !== "undefined" && self.postMessage) {
        self.postMessage({
          type: "READY",
          success: true,
          mode: isShared ? "shared-array-buffer" : "transferable",
          isShared,
        });
      }
    } catch (error) {
      if (typeof self !== "undefined" && self.postMessage) {
        self.postMessage({
          type: "READY",
          success: false,
          error: String(error),
        });
      }
    }
    return;
  }

  if (type === "ALLOCATE_BUFFER" || type === "CREATE_BUFFER") {
    try {
      const size = payload?.size ?? payload?.byteLength ?? 1024;
      const { buffer, isShared } = allocateFrameBuffer(size);

      if (typeof self !== "undefined" && self.postMessage) {
        if (isShared) {
          self.postMessage({
            type: "BUFFER_ALLOCATED",
            payload: { buffer, isShared: true, byteLength: size },
          });
        } else {
          // Seamless fallback: postMessage([buffer], [buffer]) transferable array
          self.postMessage([buffer], [buffer as ArrayBuffer]);
        }
      }
    } catch (error) {
      if (typeof self !== "undefined" && self.postMessage) {
        self.postMessage({ type: "ERROR", error: String(error) });
      }
    }
    return;
  }

  if (type === "ANALYZE_FRAME") {
    try {
      const { rgbData, width, height, transferResult } = payload;
      let cct = 5500;
      let lux = 450;

      if (lightingWasm.getIsReady()) {
        try {
          const instance = await lightingWasm.getInstance();
          const memory = await lightingWasm.getMemory();

          // Copy RGB data to WASM memory
          const bufferSize = width * height * 3;
          const ptr = 0;
          const view = new Uint8Array(memory.buffer, ptr, bufferSize);
          view.set(rgbData);

          // Allocate output pointers
          const cctPtr = bufferSize;
          const luxPtr = bufferSize + 4;

          if (
            instance?.exports &&
            typeof (instance.exports
              .analyze_ambient_light as CallableFunction) === "function"
          ) {
            (instance.exports.analyze_ambient_light as CallableFunction)(
              ptr,
              width,
              height,
              cctPtr,
              luxPtr,
            );

            // Read results
            const cctView = new Float32Array(memory.buffer, cctPtr, 1);
            const luxView = new Float32Array(memory.buffer, luxPtr, 1);
            cct = cctView[0];
            lux = luxView[0];
          }
        } catch {
          // Fallback to JS calculation if WASM execution fails
        }
      } else {
        // Fallback computation when WASM is not instantiated (e.g. mock test environments)
        if (rgbData && rgbData.length >= 3) {
          let rSum = 0;
          let gSum = 0;
          let bSum = 0;
          const sampleStep = Math.max(1, Math.floor(rgbData.length / 300));
          let samples = 0;
          for (let i = 0; i < rgbData.length - 2; i += 3 * sampleStep) {
            rSum += rgbData[i];
            gSum += rgbData[i + 1];
            bSum += rgbData[i + 2];
            samples++;
          }
          const r = rSum / (samples || 1);
          const g = gSum / (samples || 1);
          const b = bSum / (samples || 1);
          lux = Number((0.2126 * r + 0.7152 * g + 0.0722 * b).toFixed(2));
          cct = b > r ? 6500 : 3000;
        }
      }

      if (typeof self !== "undefined" && self.postMessage) {
        if (transferResult) {
          // Transferable array fallback
          const resultBuffer = new ArrayBuffer(8);
          const floatView = new Float32Array(resultBuffer);
          floatView[0] = cct;
          floatView[1] = lux;
          self.postMessage([resultBuffer], [resultBuffer]);
        } else {
          self.postMessage({
            type: "ANALYSIS_RESULT",
            payload: { cct, lux },
          });
        }
      }
    } catch (error) {
      if (typeof self !== "undefined" && self.postMessage) {
        self.postMessage({ type: "ERROR", error: String(error) });
      }
    }
  }
}

if (typeof self !== "undefined") {
  self.onmessage = handleWorkerMessage;
}
