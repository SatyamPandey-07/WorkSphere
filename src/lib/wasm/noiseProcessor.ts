/**
 * noiseProcessor.ts
 *
 * JavaScript bridge between the NoiseMeter React component and the
 * noise-processor.wasm WebAssembly module.
 *
 * Bug fix (Issue #1039): Enforces 8-byte-aligned WASM memory allocations and
 * uses the byte-offset Float32Array constructor instead of the element-index
 * shortcut to prevent unaligned memory access crashes on 32-bit ARM Android
 * Chrome.
 */

type WasmExports = {
  memory: WebAssembly.Memory;
  malloc: (size: number) => number;
  free: (ptr: number, size: number) => void;
  computeRMS: (ptr: number, length: number) => number;
  resetHeap: () => void;
};

let instancePromise: Promise<WasmExports> | null = null;

function rmsToApproxDb(rms: number): number {
  if (rms <= 0.00001) return 20;
  const dbfs = 20 * Math.log10(rms);
  return Math.max(20, Math.min(120, Math.round((dbfs + 100) * 10) / 10));
}

/**
 * Round `n` up to the next multiple of 8.
 *
 * Float32Array requires 4-byte alignment; Float64Array requires 8-byte
 * alignment. Using 8 as the universal minimum ensures that any typed-array
 * view into WASM memory is always correctly aligned on 32-bit ARM devices
 * (fixes Issue #1039).
 */
function align8(n: number): number {
  return (n + 7) & ~7;
}

/**
 * Assert that `ptr` is at least 4-byte aligned before creating a typed-array
 * view. Throws a descriptive error instead of letting the runtime crash with
 * a cryptic "memory access out of bounds" on 32-bit ARM.
 */
function assertAligned(ptr: number, alignment: number): void {
  if (ptr % alignment !== 0) {
    throw new RangeError(
      `[noiseProcessor] WASM malloc returned a misaligned pointer: ` +
        `0x${ptr.toString(16)} is not ${alignment}-byte aligned. ` +
        `This would crash on 32-bit ARM Android (Issue #1039).`,
    );
  }
}

async function loadWasm(): Promise<WasmExports> {
  const response = await fetch("/noise-processor.wasm");
  const bytes = await response.arrayBuffer();
  const wasmModule = await WebAssembly.compile(bytes);
  const instance = await WebAssembly.instantiate(wasmModule);
  return instance.exports as unknown as WasmExports;
}

function getInstance(): Promise<WasmExports> {
  if (!instancePromise) {
    instancePromise = loadWasm();
  }
  return instancePromise;
}

// ---------------------------------------------------------------------------
// Per-session buffer cache — avoids repeated malloc/free on every audio frame.
// ---------------------------------------------------------------------------
let cachedBufferPtr: number | null = null;
let cachedBufferSize = 0;

export async function processAudioFrame(
  samples: Float32Array,
): Promise<{ rms: number; db: number }> {
  const wasm = await getInstance();

  // Request 8-byte-aligned byte count (fixes Issue #1039 — Bug 2).
  // Previously this was `samples.length * 4` without alignment, which could
  // produce a misaligned pointer on the *next* malloc call.
  const bytesNeeded = align8(samples.length * Float32Array.BYTES_PER_ELEMENT);

  if (cachedBufferPtr === null || cachedBufferSize < bytesNeeded) {
    if (cachedBufferPtr !== null) {
      wasm.free(cachedBufferPtr, cachedBufferSize);
    }
    cachedBufferPtr = wasm.malloc(bytesNeeded);
    cachedBufferSize = bytesNeeded;
  }

  // Guard: verify the pointer is 4-byte aligned before any typed-array view.
  // On 32-bit ARM Chrome, an unaligned Float32Array view causes a hard crash.
  assertAligned(cachedBufferPtr, Float32Array.BYTES_PER_ELEMENT);

  // Use the byte-offset constructor instead of the element-index shortcut.
  //
  // WRONG (old code, crashes on misaligned ptr):
  //   const view = new Float32Array(wasm.memory.buffer);
  //   view.set(samples, cachedBufferPtr / 4);   ← integer division is unsafe
  //
  // CORRECT: pass the byte offset directly — the runtime validates alignment.
  const view = new Float32Array(
    wasm.memory.buffer,
    cachedBufferPtr,
    samples.length,
  );
  view.set(samples);

  const rms = wasm.computeRMS(cachedBufferPtr, samples.length);

  return { rms, db: rmsToApproxDb(rms) };
}

export async function resetNoiseProcessor(): Promise<void> {
  cachedBufferPtr = null;
  cachedBufferSize = 0;
  instancePromise = null;
}
