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

let cachedBufferPtr: number | null = null;
let cachedBufferSize = 0;

export async function processAudioFrame(
  samples: Float32Array,
): Promise<{ rms: number; db: number }> {
  const wasm = await getInstance();
  const bytesNeeded = samples.length * 4;

  if (cachedBufferPtr === null || cachedBufferSize < bytesNeeded) {
    if (cachedBufferPtr !== null) {
      wasm.free(cachedBufferPtr, cachedBufferSize);
    }
    cachedBufferPtr = wasm.malloc(bytesNeeded);
    cachedBufferSize = bytesNeeded;
  }

  const view = new Float32Array(wasm.memory.buffer);
  view.set(samples, cachedBufferPtr / 4);

  const rms = wasm.computeRMS(cachedBufferPtr, samples.length);

  return { rms, db: rmsToApproxDb(rms) };
}

export async function resetNoiseProcessor(): Promise<void> {
  cachedBufferPtr = null;
  cachedBufferSize = 0;
  instancePromise = null;
}
