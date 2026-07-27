/**
 * PDF Signature Verification Worker
 *
 * FIXED: Memory allocation leak (Issue #1751)
 * - Explicit WASM heap management with _malloc/_free
 * - 30-second idle timeout with full cleanup
 * - Buffer reference clearing for GC optimization
 * - Comprehensive error handling with guaranteed cleanup
 */

import {
  extractSignatures,
  getSignedBytes,
} from "@/lib/pdf-verify/pdfSignatureExtractor";
import { fetchCaRootsPem } from "@/lib/pdf-verify/caRoots";

// ─── Configuration ───────────────────────────────────────────────────────────
const WORKER_IDLE_TIMEOUT_MS = 30_000; // 30 seconds per issue requirements

// ─── State ───────────────────────────────────────────────────────────────────
let pdfVerifyModule: WasmModule | null = null;
let fileBuffer: Uint8Array = new Uint8Array(0);
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let isTerminated = false;

// ─── Types ───────────────────────────────────────────────────────────────────
interface WasmModule {
  _malloc: (size: number) => number;
  _free: (ptr: number) => void;
  HEAPU8: Uint8Array;
  verifyPdfSignature: (
    signedBytesPtr: number,
    signedBytesLen: number,
    contentsPtr: number,
    contentsLen: number,
    offset1: number,
    length1: number,
    offset2: number,
    length2: number,
    caRootsPtr: number,
    caRootsLen: number,
  ) => {
    valid: boolean;
    signerName: string;
    signingTime: string;
    algorithm: string;
    error: string;
  };
  destroy?: () => void;
}

// ─── Idle Timeout Management ─────────────────────────────────────────────────
function resetIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
  }
  idleTimer = setTimeout(() => {
    cleanupAndTerminate("idle_timeout");
  }, WORKER_IDLE_TIMEOUT_MS);
}

function clearIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

// ─── WASM Lifecycle ──────────────────────────────────────────────────────────
async function initWasm(): Promise<WasmModule> {
  if (pdfVerifyModule) {
    return pdfVerifyModule;
  }

  const wasmUrl = "/pdf-verify.js";
  const factoryModule = await import(/* @vite-ignore */ wasmUrl);
  const factory = factoryModule.default || factoryModule;

  pdfVerifyModule = (await factory({
    locateFile: (path: string) => {
      if (path.endsWith(".wasm")) {
        return "/pdf-verify.wasm";
      }
      return path;
    },
  })) as WasmModule;

  return pdfVerifyModule;
}

/**
 * Copies a Uint8Array into WASM heap and returns the pointer.
 * Caller MUST free the pointer with freeWasmBuffer().
 */
function copyToWasmHeap(module: WasmModule, data: Uint8Array): number {
  const ptr = module._malloc(data.length);
  if (!ptr) {
    throw new Error(`WASM _malloc failed for ${data.length} bytes`);
  }
  module.HEAPU8.set(data, ptr);
  return ptr;
}

/**
 * Safely frees a WASM heap pointer.
 */
function freeWasmBuffer(module: WasmModule, ptr: number): void {
  if (ptr) {
    module._free(ptr);
  }
}

// ─── Buffer Management ─────────────────────────────────────────────────────
/**
 * Clears a Uint8Array reference to help GC.
 * Uses ArrayBuffer.transfer() when available (Chrome 114+).
 */
function releaseBuffer(buffer: Uint8Array): void {
  try {
    const ab = buffer.buffer;
    // @ts-expect-error — ArrayBuffer.transfer is not yet in all TS targets
    if (typeof ArrayBuffer !== "undefined" && ab.transfer) {
      // @ts-expect-error ArrayBuffer.transfer not in TS DOM types yet
      ab.transfer(0);
    }
  } catch {
    // Silently fail — GC will eventually collect
  }
}

/**
 * Replaces fileBuffer with empty array, releasing old reference.
 */
function clearFileBuffer(): void {
  const oldBuffer = fileBuffer;
  fileBuffer = new Uint8Array(0);
  releaseBuffer(oldBuffer);
}

// ─── Core Verification with Guaranteed Cleanup ──────────────────────────────
async function verifySignatures(): Promise<void> {
  if (isTerminated) return;

  const wasmModule = await initWasm();
  const caRoots = await fetchCaRootsPem();
  const caRootsBytes = new TextEncoder().encode(caRoots);

  // Pre-allocate CA roots in WASM heap (reused per signature)
  const caRootsPtr = copyToWasmHeap(wasmModule, caRootsBytes);
  let caRootsFreed = false;

  try {
    const signatures = extractSignatures(fileBuffer);

    if (signatures.length === 0) {
      self.postMessage({ type: "result", signatures: [] });
      return;
    }

    self.postMessage({ type: "progress", progress: 50 });

    const results = [];

    for (const sig of signatures) {
      const signedBytes = getSignedBytes(fileBuffer, sig.byteRange);
      let signedBytesPtr = 0;
      let contentsPtr = 0;

      try {
        // Allocate WASM heap for this signature's data
        signedBytesPtr = copyToWasmHeap(wasmModule, signedBytes);
        contentsPtr = copyToWasmHeap(wasmModule, sig.contents);

        self.postMessage({ type: "progress", progress: 75 });

        const verifyResult = wasmModule.verifyPdfSignature(
          signedBytesPtr,
          signedBytes.length,
          contentsPtr,
          sig.contents.length,
          sig.byteRange.offset1,
          sig.byteRange.length1,
          sig.byteRange.offset2,
          sig.byteRange.length2,
          caRootsPtr,
          caRootsBytes.length,
        );

        results.push({
          signature: sig,
          result: {
            valid: verifyResult.valid,
            signerName: verifyResult.signerName || "",
            signingTime: verifyResult.signingTime || "",
            algorithm: verifyResult.algorithm || "",
            error: verifyResult.error || "",
          },
        });
      } finally {
        // GUARANTEED: Free WASM heap for this signature
        freeWasmBuffer(wasmModule, signedBytesPtr);
        freeWasmBuffer(wasmModule, contentsPtr);
        // GUARANTEED: Release JS ArrayBuffer reference
        releaseBuffer(signedBytes);
      }
    }

    self.postMessage({ type: "progress", progress: 100 });
    self.postMessage({ type: "result", results });
  } finally {
    // GUARANTEED: Free CA roots and clear file buffer
    if (!caRootsFreed) {
      freeWasmBuffer(wasmModule, caRootsPtr);
      caRootsFreed = true;
    }
    clearFileBuffer();
  }
}

// ─── Termination & Cleanup ─────────────────────────────────────────────────
function cleanupAndTerminate(reason: string): void {
  if (isTerminated) return;
  isTerminated = true;

  clearIdleTimer();

  // Destroy WASM module if method exists
  if (pdfVerifyModule?.destroy) {
    try {
      pdfVerifyModule.destroy();
    } catch {
      // Ignore destroy errors
    }
  }

  // Nullify all references
  pdfVerifyModule = null;
  clearFileBuffer();

  self.postMessage({ type: "terminated", reason });
  self.close();
}

// ─── Message Handler ─────────────────────────────────────────────────────────
self.onmessage = async (event: MessageEvent) => {
  if (isTerminated) return;

  const { type, payload } = event.data;
  resetIdleTimer();

  switch (type) {
    case "chunk": {
      const { chunk } = payload;
      const chunkArray = new Uint8Array(chunk);

      // Efficient buffer expansion with explicit old buffer release
      const oldBuffer = fileBuffer;
      const newBuffer = new Uint8Array(fileBuffer.length + chunkArray.length);
      newBuffer.set(fileBuffer);
      newBuffer.set(chunkArray, fileBuffer.length);
      fileBuffer = newBuffer;
      releaseBuffer(oldBuffer);
      break;
    }

    case "verify": {
      try {
        await verifySignatures();
      } catch (error) {
        self.postMessage({
          type: "error",
          error: error instanceof Error ? error.message : "Verification failed",
        });
      } finally {
        // Always clear buffer after verification attempt
        clearFileBuffer();
      }
      break;
    }

    case "reset": {
      // Explicit reset message for clean state between files
      clearFileBuffer();
      self.postMessage({ type: "reset", status: "ok" });
      break;
    }

    case "terminate": {
      cleanupAndTerminate("explicit");
      break;
    }

    default: {
      self.postMessage({
        type: "error",
        error: `Unknown message type: ${type}`,
      });
    }
  }
};

// ─── Error Handler ───────────────────────────────────────────────────────────
self.onerror = (event: any) => {
  self.postMessage({
    type: "error",
    error: `Worker error: ${event.message}`,
  });
  cleanupAndTerminate("error");
};

// ─── Unhandled Rejection Handler ─────────────────────────────────────────────
self.onunhandledrejection = (event: PromiseRejectionEvent) => {
  self.postMessage({
    type: "error",
    error: `Unhandled rejection: ${event.reason}`,
  });
  cleanupAndTerminate("unhandled_rejection");
};
