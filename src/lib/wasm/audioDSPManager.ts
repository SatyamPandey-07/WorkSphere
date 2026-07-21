/**
 * WASM SIMD Audio DSP Manager
 *
 * Manages the lifecycle of the AudioWorkletProcessor and WASM DSP engine.
 * Provides a high-level API for real-time noise suppression with <2ms latency.
 */

interface DSPManagerState {
  audioContext: AudioContext | null;
  workletNode: AudioWorkletNode | null;
  sourceNode: MediaStreamAudioSourceNode | null;
  stream: MediaStream | null;
  isProcessing: boolean;
  rmsCallback: ((rms: number) => void) | null;
  noiseProfileCallback: ((profile: Float32Array) => void) | null;
}

/**
 * Round n up to the next multiple of 16 for 128-bit SIMD vector operations.
 */
export function align16(n: number): number {
  return (n + 15) & ~15;
}

/**
 * Check if a WASM memory byte offset is 16-byte aligned.
 */
export function is16ByteAligned(ptr: number): boolean {
  return ptr % 16 === 0;
}

const state: DSPManagerState = {
  audioContext: null,
  workletNode: null,
  sourceNode: null,
  stream: null,
  isProcessing: false,
  rmsCallback: null,
  noiseProfileCallback: null,
};

async function fetchWasmBinary(): Promise<ArrayBuffer> {
  const response = await fetch("/audio-dsp-processor.wasm");
  if (!response.ok) {
    throw new Error(`Failed to load WASM DSP binary: ${response.status}`);
  }
  return response.arrayBuffer();
}

/**
 * Initialize the WASM Audio DSP pipeline.
 * Call once before starting audio processing.
 */
export async function initAudioDSP(): Promise<void> {
  if (state.audioContext) return;

  const AudioContextClass =
    window.AudioContext ||
    (
      window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }
    ).webkitAudioContext;

  if (!AudioContextClass) {
    throw new Error("Web Audio API is not supported");
  }

  state.audioContext = new AudioContextClass();

  // Register the AudioWorklet processor
  await state.audioContext.audioWorklet.addModule(
    "/lib/wasm/audioDSPWorklet.js",
  );

  // Load WASM binary
  const wasmBinary = await fetchWasmBinary();

  // Create worklet node
  state.workletNode = new AudioWorkletNode(
    state.audioContext,
    "audio-dsp-processor",
    {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    },
  );

  // Handle messages from the worklet
  state.workletNode.port.onmessage = (event) => {
    const { type, rms, profile, error } = event.data;

    switch (type) {
      case "ready":
        console.log("[AudioDSP] WASM DSP engine initialized");
        break;
      case "error":
        console.error("[AudioDSP] Worklet error:", error);
        break;
      case "rms":
        state.rmsCallback?.(rms);
        break;
      case "noiseProfile":
        state.noiseProfileCallback?.(profile);
        break;
    }
  };

  // Initialize WASM in the worklet
  state.workletNode.port.postMessage({
    type: "init",
    wasmBinary,
  });
}

/**
 * Start processing audio from the microphone.
 * Returns cleanup function.
 */
export async function startAudioProcessing(
  onRms: (rms: number) => void,
  options: {
    echoCancellation?: boolean;
    noiseSuppression?: boolean;
    autoGainControl?: boolean;
  } = {},
): Promise<() => void> {
  if (!state.audioContext || !state.workletNode) {
    throw new Error("AudioDSP not initialized. Call initAudioDSP() first.");
  }

  state.rmsCallback = onRms;

  // Resume AudioContext if suspended
  if (state.audioContext.state === "suspended") {
    await state.audioContext.resume();
  }

  // Get microphone stream
  state.stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: options.echoCancellation ?? false,
      noiseSuppression: options.noiseSuppression ?? false,
      autoGainControl: options.autoGainControl ?? false,
      channelCount: 1,
      sampleRate: 48000,
    },
  });

  // Create source node
  state.sourceNode = state.audioContext.createMediaStreamSource(state.stream);

  // Connect: source -> worklet -> destination
  state.sourceNode.connect(state.workletNode);
  state.workletNode.connect(state.audioContext.destination);

  state.isProcessing = true;

  // Return cleanup function
  return () => {
    stopAudioProcessing();
  };
}

/**
 * Stop audio processing and release resources.
 */
export function stopAudioProcessing(): void {
  if (state.sourceNode) {
    state.sourceNode.disconnect();
    state.sourceNode = null;
  }

  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }

  if (state.workletNode) {
    state.workletNode.disconnect();
  }

  state.isProcessing = false;
  state.rmsCallback = null;
  state.noiseProfileCallback = null;
}

/**
 * Set noise gate sensitivity (0.0 = aggressive, 1.0 = minimal filtering).
 */
export function setSensitivity(sensitivity: number): void {
  state.workletNode?.port.postMessage({
    type: "setSensitivity",
    sensitivity,
  });
}

/**
 * Reset noise calibration.
 */
export function resetCalibration(): void {
  state.workletNode?.port.postMessage({ type: "reset" });
}

/**
 * Get the current noise profile (for visualization).
 */
export function getNoiseProfile(
  callback: (profile: Float32Array) => void,
): void {
  state.noiseProfileCallback = callback;
  state.workletNode?.port.postMessage({ type: "getNoiseProfile" });
}

/**
 * Check if the DSP engine is ready.
 */
export function isDSPReady(): boolean {
  return state.isProcessing;
}

/**
 * Get the current AudioContext sample rate.
 */
export function getSampleRate(): number {
  return state.audioContext?.sampleRate ?? 48000;
}
