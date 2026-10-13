/**
 * spatialMasking.ts
 *
 * WebAssembly Spatial Masking & Dynamic Acoustic Privacy Engine.
 * Dynamically dimensions FFT buffers for variable sample rates (44.1kHz, 48kHz, 96kHz),
 * enforces strict bounds checking before windowing dot-products, and processes
 * multi-channel audio streams to prevent WASM linear memory corruption (#5888).
 */

export interface SpatialMaskingWasmExports {
  init_hann_window: (windowPtr: number, windowSize: number) => number;
  apply_hann_window: (
    inPtr: number,
    outPtr: number,
    numSamples: number,
    windowPtr: number,
    windowSize: number,
  ) => number;
  spatial_masking_init: (
    statePtr: number,
    sampleRate: number,
    blockSize: number,
  ) => number;
  ensure_spatial_masking_capacity: (
    statePtr: number,
    sampleRate: number,
    numSamples: number,
  ) => number;
  spatial_masking_free: (statePtr: number) => void;
  spatial_masking_process_channel: (
    statePtr: number,
    inPtr: number,
    outPtr: number,
    numSamples: number,
    sampleRate: number,
    maskIntensity: number,
    seed: number,
  ) => number;
  process_spatial_masking_multichannel: (
    statePtr: number,
    inChannelsPtr: number,
    outChannelsPtr: number,
    numChannels: number,
    numSamples: number,
    sampleRate: number,
    maskIntensity: number,
    seed: number,
  ) => number;
  generate_phase_inversion_n: (
    inPtr: number,
    outPtr: number,
    numSamples: number,
  ) => void;
  generate_speech_mask_n: (
    outPtr: number,
    numSamples: number,
    intensity: number,
    seed: number,
    sampleRate: number,
  ) => void;
  generate_phase_inversion: (inPtr: number, outPtr: number) => void;
  generate_speech_mask: (
    outPtr: number,
    intensity: number,
    seed: number,
  ) => void;
  apply_privacy_masking: (
    capturedAudioPtr: number,
    outputFramePtr: number,
    maskIntensity: number,
    seed: number,
  ) => void;
  wasm_malloc: (size: number) => number;
  wasm_free: (ptr: number) => void;
  HEAPF32: Float32Array;
  HEAP32: Int32Array;
  memoryBuffer: ArrayBuffer;
}

export interface SpatialMaskingOptions {
  sampleRate?: number;
  blockSize?: number;
  maskIntensity?: number;
  seed?: number;
}

export const DEFAULT_SAMPLE_RATE = 44100;
export const MIN_SAMPLE_RATE = 8000;
export const MAX_SAMPLE_RATE = 192000;
export const MIN_BLOCK_SIZE = 64;
export const MAX_BLOCK_SIZE = 16384;
export const DEFAULT_BLOCK_SIZE = 2048;

/**
 * Creates a faithful WebAssembly linear memory and DSP execution harness
 * matching `src/wasm/audio/spatial_masking.c` (#5888).
 */
export function createSpatialMaskingHarness(
  memorySizeBytes: number = 256 * 1024,
): SpatialMaskingWasmExports {
  const memoryBuffer = new ArrayBuffer(memorySizeBytes);
  const floatView = new Float32Array(memoryBuffer);
  const intView = new Int32Array(memoryBuffer);

  // Simple bump allocator for testing WASM linear memory
  let heapOffset = 4096;
  const wasm_malloc = (size: number): number => {
    if (size <= 0) return 0;
    const alignedSize = (size + 7) & ~7;
    const ptr = heapOffset;
    heapOffset += alignedSize;
    if (heapOffset > memorySizeBytes) {
      throw new Error("WASM out of memory in test harness");
    }
    return ptr;
  };

  const wasm_free = (_ptr: number): void => {
    // No-op for bump allocator in harness
  };

  const next_power_of_two = (n: number): number => {
    if (n <= MIN_BLOCK_SIZE) return MIN_BLOCK_SIZE;
    if (n >= MAX_BLOCK_SIZE) return MAX_BLOCK_SIZE;
    let p = 1;
    while (p < n && p < MAX_BLOCK_SIZE) {
      p <<= 1;
    }
    return p;
  };

  const init_hann_window = (windowPtr: number, windowSize: number): number => {
    if (windowPtr <= 0 || windowSize <= 0 || windowPtr % 4 !== 0) {
      return -1;
    }
    const idx = windowPtr / 4;
    if (windowSize === 1) {
      floatView[idx] = 1.0;
      return 0;
    }
    for (let i = 0; i < windowSize; i++) {
      floatView[idx + i] =
        0.5 * (1.0 - Math.cos((2.0 * Math.PI * i) / (windowSize - 1)));
    }
    return 0;
  };

  const spatial_masking_init = (
    statePtr: number,
    sampleRate: number,
    blockSize: number,
  ): number => {
    if (statePtr <= 0 || statePtr % 4 !== 0) return -1;
    const stateIdx = statePtr / 4;

    const safeRate =
      sampleRate >= MIN_SAMPLE_RATE && sampleRate <= MAX_SAMPLE_RATE
        ? sampleRate
        : DEFAULT_SAMPLE_RATE;

    let requestedSize = blockSize;
    if (requestedSize <= 0) {
      if (safeRate >= 96000) requestedSize = 4096;
      else if (safeRate >= 48000) requestedSize = 2048;
      else requestedSize = DEFAULT_BLOCK_SIZE;
    }

    let targetCapacity = next_power_of_two(requestedSize);
    if (targetCapacity < MIN_BLOCK_SIZE) targetCapacity = MIN_BLOCK_SIZE;
    if (targetCapacity > MAX_BLOCK_SIZE) targetCapacity = MAX_BLOCK_SIZE;

    // Struct offsets:
    // stateIdx + 0: window_buffer ptr (int32)
    // stateIdx + 1: temp_in ptr (int32)
    // stateIdx + 2: temp_out ptr (int32)
    // stateIdx + 3: window_size (int32)
    // stateIdx + 4: configured_sample_rate (int32)
    // stateIdx + 5: configured_block_size (int32)
    // stateIdx + 6: is_initialized (int32)

    const currentCap = intView[stateIdx + 3];
    const isInit = intView[stateIdx + 6];

    if (!isInit || currentCap < targetCapacity) {
      const windowBufPtr = wasm_malloc(targetCapacity * 4);
      const tempInPtr = wasm_malloc(targetCapacity * 4);
      const tempOutPtr = wasm_malloc(targetCapacity * 4);

      intView[stateIdx + 0] = windowBufPtr;
      intView[stateIdx + 1] = tempInPtr;
      intView[stateIdx + 2] = tempOutPtr;
      intView[stateIdx + 3] = targetCapacity;
    }

    const windowBuf = intView[stateIdx + 0];
    init_hann_window(windowBuf, targetCapacity);

    intView[stateIdx + 4] = safeRate;
    intView[stateIdx + 5] = targetCapacity;
    intView[stateIdx + 6] = 1;

    return 0;
  };

  const ensure_spatial_masking_capacity = (
    statePtr: number,
    sampleRate: number,
    numSamples: number,
  ): number => {
    if (statePtr <= 0 || statePtr % 4 !== 0) return -1;
    const stateIdx = statePtr / 4;
    const currentCap = intView[stateIdx + 3];
    const currentRate = intView[stateIdx + 4];
    const isInit = intView[stateIdx + 6];

    if (!isInit || currentCap < numSamples || currentRate !== sampleRate) {
      return spatial_masking_init(statePtr, sampleRate, numSamples);
    }
    return 0;
  };

  const spatial_masking_free = (statePtr: number): void => {
    if (statePtr <= 0 || statePtr % 4 !== 0) return;
    const stateIdx = statePtr / 4;
    intView[stateIdx + 0] = 0;
    intView[stateIdx + 1] = 0;
    intView[stateIdx + 2] = 0;
    intView[stateIdx + 3] = 0;
    intView[stateIdx + 4] = 0;
    intView[stateIdx + 5] = 0;
    intView[stateIdx + 6] = 0;
  };

  const apply_hann_window = (
    inPtr: number,
    outPtr: number,
    numSamples: number,
    windowPtr: number,
    windowSize: number,
  ): number => {
    if (
      inPtr <= 0 ||
      outPtr <= 0 ||
      windowPtr <= 0 ||
      inPtr % 4 !== 0 ||
      outPtr % 4 !== 0 ||
      windowPtr % 4 !== 0
    ) {
      return -1;
    }
    if (numSamples <= 0 || windowSize <= 0) {
      return -1;
    }

    // Strict bounds check before executing windowing dot-product (#5888)
    let processSamples = numSamples;
    if (processSamples > windowSize) {
      processSamples = windowSize;
    }

    const inIdx = inPtr / 4;
    const outIdx = outPtr / 4;
    const winIdx = windowPtr / 4;

    for (let i = 0; i < processSamples; i++) {
      floatView[outIdx + i] = floatView[inIdx + i] * floatView[winIdx + i];
    }

    return processSamples;
  };

  const generate_phase_inversion_n = (
    inPtr: number,
    outPtr: number,
    numSamples: number,
  ): void => {
    if (inPtr <= 0 || outPtr <= 0 || numSamples <= 0) return;
    const inIdx = inPtr / 4;
    const outIdx = outPtr / 4;
    for (let i = 0; i < numSamples; i++) {
      floatView[outIdx + i] = -floatView[inIdx + i];
    }
  };

  const generate_phase_inversion = (inPtr: number, outPtr: number): void => {
    generate_phase_inversion_n(inPtr, outPtr, 512);
  };

  const generate_speech_mask_n = (
    outPtr: number,
    numSamples: number,
    intensity: number,
    seed: number,
    sampleRate: number,
  ): void => {
    if (outPtr <= 0 || numSamples <= 0) return;
    let state = seed >>> 0;
    const rate = sampleRate > 0 ? sampleRate : DEFAULT_SAMPLE_RATE;
    const omega = (2.0 * Math.PI * 1000.0) / rate;
    const outIdx = outPtr / 4;

    for (let i = 0; i < numSamples; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const noise = (state >>> 16) / 32768.0 - 1.0;
      const speechBandEnergy = Math.sin(i * omega) * 0.5 + 0.5;
      floatView[outIdx + i] = noise * intensity * speechBandEnergy;
    }
  };

  const generate_speech_mask = (
    outPtr: number,
    intensity: number,
    seed: number,
  ): void => {
    generate_speech_mask_n(outPtr, 512, intensity, seed, DEFAULT_SAMPLE_RATE);
  };

  const apply_privacy_masking = (
    capturedAudioPtr: number,
    outputFramePtr: number,
    maskIntensity: number,
    seed: number,
  ): void => {
    if (capturedAudioPtr <= 0 || outputFramePtr <= 0) return;
    const inIdx = capturedAudioPtr / 4;
    const outIdx = outputFramePtr / 4;

    let state = seed >>> 0;
    for (let i = 0; i < 512; i++) {
      const inverted = -floatView[inIdx + i];
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const noise = (state >>> 16) / 32768.0 - 1.0;
      const speechBand = Math.sin(i * 0.1) * 0.5 + 0.5;
      const mask = noise * maskIntensity * speechBand;

      let mixed = inverted * 0.3 + mask * 0.7;
      if (mixed > 1.0) mixed = 1.0;
      if (mixed < -1.0) mixed = -1.0;
      floatView[outIdx + i] = mixed;
    }
  };

  const spatial_masking_process_channel = (
    statePtr: number,
    inPtr: number,
    outPtr: number,
    numSamples: number,
    sampleRate: number,
    maskIntensity: number,
    seed: number,
  ): number => {
    if (statePtr <= 0 || inPtr <= 0 || outPtr <= 0 || numSamples <= 0) {
      return -1;
    }
    if (ensure_spatial_masking_capacity(statePtr, sampleRate, numSamples) !== 0) {
      return -2;
    }

    const stateIdx = statePtr / 4;
    const windowBufPtr = intView[stateIdx + 0];
    const tempInPtr = intView[stateIdx + 1];
    const tempOutPtr = intView[stateIdx + 2];
    const windowSize = intView[stateIdx + 3];

    let processed = 0;
    while (processed < numSamples) {
      let currentChunk = numSamples - processed;
      if (currentChunk > windowSize) {
        currentChunk = windowSize;
      }

      const chunkInPtr = inPtr + processed * 4;
      const chunkOutPtr = outPtr + processed * 4;

      const windowed = apply_hann_window(
        chunkInPtr,
        tempInPtr,
        currentChunk,
        windowBufPtr,
        windowSize,
      );
      if (windowed <= 0) return -3;

      generate_phase_inversion_n(tempInPtr, tempInPtr, windowed);
      generate_speech_mask_n(
        tempOutPtr,
        windowed,
        maskIntensity,
        seed + processed,
        sampleRate,
      );

      const inChunkIdx = tempInPtr / 4;
      const outMaskIdx = tempOutPtr / 4;
      const outIdx = chunkOutPtr / 4;

      for (let i = 0; i < windowed; i++) {
        let mixed =
          floatView[inChunkIdx + i] * 0.3 + floatView[outMaskIdx + i] * 0.7;
        if (mixed > 1.0) mixed = 1.0;
        if (mixed < -1.0) mixed = -1.0;
        floatView[outIdx + i] = mixed;
      }

      processed += windowed;
    }

    return 0;
  };

  const process_spatial_masking_multichannel = (
    statePtr: number,
    inChannelsPtr: number,
    outChannelsPtr: number,
    numChannels: number,
    numSamples: number,
    sampleRate: number,
    maskIntensity: number,
    seed: number,
  ): number => {
    if (
      statePtr <= 0 ||
      inChannelsPtr <= 0 ||
      outChannelsPtr <= 0 ||
      numChannels <= 0 ||
      numSamples <= 0
    ) {
      return -1;
    }

    if (ensure_spatial_masking_capacity(statePtr, sampleRate, numSamples) !== 0) {
      return -2;
    }

    const inChIdx = inChannelsPtr / 4;
    const outChIdx = outChannelsPtr / 4;

    for (let ch = 0; ch < numChannels; ch++) {
      const inChPtr = intView[inChIdx + ch];
      const outChPtr = intView[outChIdx + ch];
      if (inChPtr <= 0 || outChPtr <= 0) return -3;

      const channelSeed = seed + ch * 7919;
      const res = spatial_masking_process_channel(
        statePtr,
        inChPtr,
        outChPtr,
        numSamples,
        sampleRate,
        maskIntensity,
        channelSeed,
      );
      if (res !== 0) return res;
    }

    return 0;
  };

  return {
    init_hann_window,
    apply_hann_window,
    spatial_masking_init,
    ensure_spatial_masking_capacity,
    spatial_masking_free,
    spatial_masking_process_channel,
    process_spatial_masking_multichannel,
    generate_phase_inversion_n,
    generate_speech_mask_n,
    generate_phase_inversion,
    generate_speech_mask,
    apply_privacy_masking,
    wasm_malloc,
    wasm_free,
    get HEAPF32() {
      return floatView;
    },
    get HEAP32() {
      return intView;
    },
    memoryBuffer,
  };
}

/**
 * High-level TypeScript helper to process multi-channel audio through spatial masking.
 */
export function processSpatialMasking(
  channels: Float32Array[],
  options: SpatialMaskingOptions = {},
): Float32Array[] {
  if (!channels || channels.length === 0) return [];
  const numSamples = channels[0].length;
  if (numSamples === 0) return channels.map(() => new Float32Array(0));

  const sampleRate = options.sampleRate || DEFAULT_SAMPLE_RATE;
  const blockSize = options.blockSize || numSamples;
  const intensity = options.maskIntensity ?? 0.5;
  const seed = options.seed ?? 12345;

  const wasm = createSpatialMaskingHarness();
  const statePtr = wasm.wasm_malloc(64);
  wasm.spatial_masking_init(statePtr, sampleRate, blockSize);

  const numChannels = channels.length;
  const inPointersPtr = wasm.wasm_malloc(numChannels * 4);
  const outPointersPtr = wasm.wasm_malloc(numChannels * 4);

  const outPointers: number[] = [];

  for (let ch = 0; ch < numChannels; ch++) {
    const inChannelPtr = wasm.wasm_malloc(numSamples * 4);
    const outChannelPtr = wasm.wasm_malloc(numSamples * 4);

    wasm.HEAPF32.set(channels[ch], inChannelPtr / 4);
    wasm.HEAP32[inPointersPtr / 4 + ch] = inChannelPtr;
    wasm.HEAP32[outPointersPtr / 4 + ch] = outChannelPtr;
    outPointers.push(outChannelPtr);
  }

  const result = wasm.process_spatial_masking_multichannel(
    statePtr,
    inPointersPtr,
    outPointersPtr,
    numChannels,
    numSamples,
    sampleRate,
    intensity,
    seed,
  );

  if (result !== 0) {
    throw new Error(`Spatial masking failed with status code ${result}`);
  }

  const outputChannels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    const outPtr = outPointers[ch];
    const channelData = new Float32Array(numSamples);
    channelData.set(wasm.HEAPF32.subarray(outPtr / 4, outPtr / 4 + numSamples));
    outputChannels.push(channelData);
  }

  wasm.spatial_masking_free(statePtr);
  return outputChannels;
}
