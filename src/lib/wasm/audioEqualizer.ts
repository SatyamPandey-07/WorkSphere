export type BiquadCoefficients = {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
};

export type EqBand = {
  frequency: number;
  q: number;
  gain: number;
};

export type FrequencyResponse = {
  frequencies: Float32Array;
  magnitudes: Float32Array;
};

type WasmExports = {
  memory: WebAssembly.Memory;
  malloc: (size: number) => number;
  free: (ptr: number, size: number) => void;
  resetHeap: () => void;
  setBandsPtr: (ptr: number) => void;
  initBiquadState: (
    bandIndex: number,
    b0: number,
    b1: number,
    b2: number,
    a1: number,
    a2: number,
  ) => void;
  processSample: (input: number, numBands: number) => number;
  processBlock: (
    inputPtr: number,
    outputPtr: number,
    length: number,
    numBands: number,
  ) => void;
};

let instancePromise: Promise<WasmExports> | null = null;
let bandsMemoryPtr: number | null = null;
let cachedInputPtr: number | null = null;
let cachedOutputPtr: number | null = null;
let cachedBufferSize = 0;
let currentNumBands = 0;
let currentSampleRate = 44100;

function computePeakingCoefficients(
  fc: number,
  q: number,
  gainDB: number,
  sampleRate: number,
): BiquadCoefficients {
  const A = Math.pow(10, gainDB / 40);
  const w0 = (2 * Math.PI * fc) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const cosW0 = Math.cos(w0);

  const b0 = 1 + alpha * A;
  const b1 = -2 * cosW0;
  const b2 = 1 - alpha * A;
  const a0 = 1 + alpha / A;
  const a1 = -2 * cosW0;
  const a2 = 1 - alpha / A;

  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

async function loadWasm(): Promise<WasmExports> {
  const response = await fetch("/audio-equalizer.wasm");
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

export async function initEqualizer(
  bands: EqBand[],
  sampleRate = 44100,
): Promise<void> {
  const wasm = await getInstance();
  currentNumBands = bands.length;
  currentSampleRate = sampleRate;

  if (bandsMemoryPtr !== null) {
    wasm.free(bandsMemoryPtr, currentNumBands * 36);
  }

  bandsMemoryPtr = wasm.malloc(bands.length * 36);
  wasm.setBandsPtr(bandsMemoryPtr);

  for (let i = 0; i < bands.length; i++) {
    const { frequency, q, gain } = bands[i];
    const coeffs = computePeakingCoefficients(frequency, q, gain, sampleRate);
    wasm.initBiquadState(i, coeffs.b0, coeffs.b1, coeffs.b2, coeffs.a1, coeffs.a2);
  }
}

export async function updateBand(
  index: number,
  frequency: number,
  q: number,
  gain: number,
): Promise<void> {
  const wasm = await getInstance();
  const coeffs = computePeakingCoefficients(frequency, q, gain, currentSampleRate);
  wasm.initBiquadState(index, coeffs.b0, coeffs.b1, coeffs.b2, coeffs.a1, coeffs.a2);
}

export async function processAudioBlock(
  samples: Float32Array,
): Promise<Float32Array> {
  const wasm = await getInstance();
  const bytesNeeded = samples.length * 4;

  if (cachedInputPtr === null || cachedBufferSize < bytesNeeded) {
    if (cachedInputPtr !== null) {
      wasm.free(cachedInputPtr, cachedBufferSize);
      wasm.free(cachedOutputPtr!, cachedBufferSize);
    }
    cachedInputPtr = wasm.malloc(bytesNeeded);
    cachedOutputPtr = wasm.malloc(bytesNeeded);
    cachedBufferSize = bytesNeeded;
  }

  const view = new Float32Array(wasm.memory.buffer);
  view.set(samples, cachedInputPtr / 4);

  wasm.processBlock(cachedInputPtr, cachedOutputPtr!, samples.length, currentNumBands);

  const output = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    output[i] = view[cachedOutputPtr! / 4 + i];
  }

  return output;
}

function computeBandResponse(
  freq: number,
  coeffs: BiquadCoefficients,
  sampleRate: number,
): number {
  const w = (2 * Math.PI * freq) / sampleRate;
  const cosW = Math.cos(w);
  const sinW = Math.sin(w);

  const numRe = coeffs.b0 + coeffs.b1 * cosW + coeffs.b2 * Math.cos(2 * w);
  const numIm = coeffs.b1 * sinW + coeffs.b2 * Math.sin(2 * w);
  const denRe = 1 + coeffs.a1 * cosW + coeffs.a2 * Math.cos(2 * w);
  const denIm = coeffs.a1 * sinW + coeffs.a2 * Math.sin(2 * w);

  const mag = Math.sqrt(
    (numRe * numRe + numIm * numIm) / (denRe * denRe + denIm * denIm),
  );

  return 20 * Math.log10(mag);
}

export async function getFrequencyResponse(
  bands: EqBand[],
  sampleRate = 44100,
  numPoints = 256,
): Promise<FrequencyResponse> {
  const minLog = Math.log10(20);
  const maxLog = Math.log10(20000);
  const step = (maxLog - minLog) / (numPoints - 1);

  const frequencies = new Float32Array(numPoints);
  const magnitudes = new Float32Array(numPoints);

  const coeffsList = bands.map(({ frequency, q, gain }) =>
    computePeakingCoefficients(frequency, q, gain, sampleRate),
  );

  for (let i = 0; i < numPoints; i++) {
    const freq = Math.pow(10, minLog + step * i);
    frequencies[i] = freq;

    let totalMag = 0;
    for (const coeffs of coeffsList) {
      totalMag += computeBandResponse(freq, coeffs, sampleRate);
    }
    magnitudes[i] = totalMag;
  }

  return { frequencies, magnitudes };
}

export async function resetEqualizer(): Promise<void> {
  if (instancePromise) {
    const wasm = await instancePromise;
    if (bandsMemoryPtr !== null) {
      wasm.free(bandsMemoryPtr, currentNumBands * 36);
      bandsMemoryPtr = null;
    }
    if (cachedInputPtr !== null) {
      wasm.free(cachedInputPtr, cachedBufferSize);
      wasm.free(cachedOutputPtr!, cachedBufferSize);
      cachedInputPtr = null;
      cachedOutputPtr = null;
      cachedBufferSize = 0;
    }
    wasm.resetHeap();
  }
  instancePromise = null;
  currentNumBands = 0;
}

export const DEFAULT_BANDS: EqBand[] = [
  { frequency: 31, q: 0.707, gain: 0 },
  { frequency: 62, q: 0.707, gain: 0 },
  { frequency: 125, q: 0.707, gain: 0 },
  { frequency: 250, q: 0.707, gain: 0 },
  { frequency: 500, q: 0.707, gain: 0 },
  { frequency: 1000, q: 0.707, gain: 0 },
  { frequency: 2000, q: 0.707, gain: 0 },
  { frequency: 4000, q: 0.707, gain: 0 },
  { frequency: 8000, q: 0.707, gain: 0 },
  { frequency: 16000, q: 0.707, gain: 0 },
];
