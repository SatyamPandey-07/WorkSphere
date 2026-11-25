/**
 * @file audioSynthesizerWorker.ts
 * @description Dedicated multi-threaded Web Worker for procedural audio synthesis
 * of binaural soundscapes (pink noise, brown noise, white noise, and rain texture).
 *
 * Runs off the main UI thread, generates 32-bit floating point audio buffers,
 * applies smooth frequency cutoff filtering, and transfers ArrayBuffers to the
 * playback thread with zero main-thread memory copies.
 */

export type NoiseType = 'pink' | 'brown' | 'white' | 'rain';

export interface SynthesizeAudioRequest {
  type: 'SYNTHESIZE' | 'GENERATE_CHUNK';
  noiseType: NoiseType;
  durationSeconds?: number;
  sampleRate?: number;
  channels?: number;
  cutoffFrequency?: number;
  binauralDetuneHz?: number;
  bufferSize?: number;
  correlation?: number;
}

export interface SetCutoffRequest {
  type: 'SET_CUTOFF';
  cutoffFrequency: number;
}

export interface ResetWorkerRequest {
  type: 'RESET';
}

export type AudioWorkerMessage =
  | SynthesizeAudioRequest
  | SetCutoffRequest
  | ResetWorkerRequest;

export interface SynthesizedAudioPayload {
  noiseType: NoiseType;
  sampleRate: number;
  channels: number;
  length: number;
  cutoffFrequency?: number;
  buffers: ArrayBuffer[]; // One transferable ArrayBuffer per channel
}

export interface AudioWorkerResponse {
  type: 'CHUNK_READY' | 'SYNTHESIZED' | 'CONFIG_UPDATED' | 'ERROR';
  payload?: SynthesizedAudioPayload | { message: string } | { cutoffFrequency: number };
}

export interface NoiseGeneratorState {
  // Pink noise Kellet filter states per channel
  pinkState: {
    b0: number;
    b1: number;
    b2: number;
    b3: number;
    b4: number;
    b5: number;
    b6: number;
  }[];
  // Brown noise running integrator states per channel
  brownState: number[];
  // Rain filter & droplet states per channel
  rainSmooth: number[];
  rainDroplet: number[];
  // Single-pole low-pass filter state for frequency cutoff
  filterState: number[];
  currentCutoffHz: number;
}

/**
 * Generates raw pink noise samples using Paul Kellet's 7-pole filter approximation (1/f, -3dB/octave).
 */
export function generatePinkNoiseChannel(
  length: number,
  state: { b0: number; b1: number; b2: number; b3: number; b4: number; b5: number; b6: number },
  rng: () => number = Math.random
): Float32Array {
  const output = new Float32Array(length);
  let { b0, b1, b2, b3, b4, b5, b6 } = state;

  for (let i = 0; i < length; i++) {
    const white = rng() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
    output[i] = Math.max(-1, Math.min(1, pink));
  }

  state.b0 = b0;
  state.b1 = b1;
  state.b2 = b2;
  state.b3 = b3;
  state.b4 = b4;
  state.b5 = b5;
  state.b6 = b6;

  return output;
}

/**
 * Generates raw brown noise samples (Brownian / red noise, -6dB/octave integrated white noise).
 */
export function generateBrownNoiseChannel(
  length: number,
  state: { lastOut: number },
  rng: () => number = Math.random
): Float32Array {
  const output = new Float32Array(length);
  let lastOut = state.lastOut;

  for (let i = 0; i < length; i++) {
    const white = rng() * 2 - 1;
    lastOut = (lastOut + 0.02 * white) / 1.02;
    // Scale and soft clamp
    const val = lastOut * 3.5;
    output[i] = Math.max(-1, Math.min(1, val));
  }

  state.lastOut = lastOut;
  return output;
}

/**
 * Generates white noise samples uniformly distributed in [-1, 1].
 */
export function generateWhiteNoiseChannel(
  length: number,
  rng: () => number = Math.random
): Float32Array {
  const output = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    output[i] = rng() * 2 - 1;
  }
  return output;
}

/**
 * Generates procedural rain noise texture with lowpass wash and random droplet envelopes.
 */
export function generateRainChannel(
  length: number,
  sampleRate: number,
  state: { smooth: number; dropletEnv: number },
  rng: () => number = Math.random
): Float32Array {
  const output = new Float32Array(length);
  const decay = Math.exp(-1 / Math.max(1, sampleRate * 0.018));
  let { smooth, dropletEnv } = state;

  for (let i = 0; i < length; i++) {
    const white = rng() * 2 - 1;
    smooth = 0.82 * smooth + 0.18 * white;
    if (rng() < 0.0015) {
      dropletEnv = Math.max(dropletEnv, rng() * 0.75);
    } else {
      dropletEnv *= decay;
    }
    const rainSample = smooth * 0.55 + white * dropletEnv * 0.45;
    output[i] = Math.max(-1, Math.min(1, rainSample));
  }

  state.smooth = smooth;
  state.dropletEnv = dropletEnv;
  return output;
}

/**
 * Smooth single-pole lowpass filter with parameter interpolation to prevent pops and clicks.
 */
export function applySmoothCutoffFilter(
  samples: Float32Array,
  sampleRate: number,
  startCutoffHz: number,
  targetCutoffHz: number,
  filterStateRef: { lastSample: number }
): void {
  const length = samples.length;
  let lastSample = filterStateRef.lastSample;
  const clampedStart = Math.max(20, Math.min(sampleRate * 0.49, startCutoffHz));
  const clampedTarget = Math.max(20, Math.min(sampleRate * 0.49, targetCutoffHz));

  for (let i = 0; i < length; i++) {
    // Linear parameter ramping across chunk to prevent sudden discontinuities
    const progress = length > 1 ? i / (length - 1) : 1;
    const currentHz = clampedStart + progress * (clampedTarget - clampedStart);

    // Single-pole alpha: dt / (RC + dt)
    const rc = 1.0 / (2 * Math.PI * currentHz);
    const dt = 1.0 / sampleRate;
    const alpha = dt / (rc + dt);

    lastSample += alpha * (samples[i] - lastSample);
    samples[i] = lastSample;
  }

  filterStateRef.lastSample = lastSample;
}

/**
 * Core synthesis function producing Float32Array channel data according to the request options.
 */
export function synthesizeSoundscapeBuffers(
  request: SynthesizeAudioRequest,
  generatorState?: NoiseGeneratorState,
  rng: () => number = Math.random
): { channelBuffers: Float32Array[]; sampleRate: number; channels: number } {
  const sampleRate = Math.max(8000, Math.min(192000, request.sampleRate ?? 44100));
  const channels = Math.max(1, Math.min(8, request.channels ?? 2));
  const length = request.bufferSize
    ? Math.max(64, Math.floor(request.bufferSize))
    : Math.max(64, Math.floor((request.durationSeconds ?? 3) * sampleRate));

  const noiseType = request.noiseType || 'pink';
  const cutoff = request.cutoffFrequency;

  // Initialize or maintain state
  const state = generatorState ?? {
    pinkState: Array.from({ length: channels }, () => ({
      b0: 0,
      b1: 0,
      b2: 0,
      b3: 0,
      b4: 0,
      b5: 0,
      b6: 0,
    })),
    brownState: Array.from({ length: channels }, () => 0),
    rainSmooth: Array.from({ length: channels }, () => 0),
    rainDroplet: Array.from({ length: channels }, () => 0),
    filterState: Array.from({ length: channels }, () => 0),
    currentCutoffHz: cutoff ?? 12000,
  };

  while (state.pinkState.length < channels) {
    state.pinkState.push({ b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0 });
    state.brownState.push(0);
    state.rainSmooth.push(0);
    state.rainDroplet.push(0);
    state.filterState.push(0);
  }

  const channelBuffers: Float32Array[] = [];

  for (let c = 0; c < channels; c++) {
    let raw: Float32Array;

    switch (noiseType) {
      case 'pink':
        raw = generatePinkNoiseChannel(length, state.pinkState[c], rng);
        break;
      case 'brown': {
        const brownRef = { lastOut: state.brownState[c] };
        raw = generateBrownNoiseChannel(length, brownRef, rng);
        state.brownState[c] = brownRef.lastOut;
        break;
      }
      case 'rain': {
        const rainRef = {
          smooth: state.rainSmooth[c],
          dropletEnv: state.rainDroplet[c],
        };
        raw = generateRainChannel(length, sampleRate, rainRef, rng);
        state.rainSmooth[c] = rainRef.smooth;
        state.rainDroplet[c] = rainRef.dropletEnv;
        break;
      }
      case 'white':
      default:
        raw = generateWhiteNoiseChannel(length, rng);
        break;
    }

    // Apply cutoff filter if specified or if previously filtered
    if (cutoff !== undefined && Number.isFinite(cutoff)) {
      const filtRef = { lastSample: state.filterState[c] };
      applySmoothCutoffFilter(
        raw,
        sampleRate,
        state.currentCutoffHz,
        cutoff,
        filtRef
      );
      state.filterState[c] = filtRef.lastSample;
    }

    channelBuffers.push(raw);
  }

  if (cutoff !== undefined && Number.isFinite(cutoff)) {
    state.currentCutoffHz = cutoff;
  }

  return { channelBuffers, sampleRate, channels };
}

/**
 * Message handler for worker execution or test environments.
 */
export function handleWorkerMessage(
  data: unknown,
  state: NoiseGeneratorState,
  postMessageFn: (response: AudioWorkerResponse, transfer?: Transferable[]) => void
): void {
  if (!data || typeof data !== 'object') {
    postMessageFn({
      type: 'ERROR',
      payload: { message: 'Invalid worker message: payload must be an object' },
    });
    return;
  }

  const msg = data as Partial<AudioWorkerMessage>;

  try {
    switch (msg.type) {
      case 'SET_CUTOFF': {
        const cutoff = (msg as SetCutoffRequest).cutoffFrequency;
        if (typeof cutoff !== 'number' || !Number.isFinite(cutoff) || cutoff <= 0) {
          postMessageFn({
            type: 'ERROR',
            payload: { message: `Invalid cutoff frequency: ${cutoff}` },
          });
          return;
        }
        state.currentCutoffHz = cutoff;
        postMessageFn({
          type: 'CONFIG_UPDATED',
          payload: { cutoffFrequency: cutoff },
        });
        break;
      }

      case 'RESET': {
        for (let i = 0; i < state.pinkState.length; i++) {
          state.pinkState[i] = { b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0 };
          state.brownState[i] = 0;
          state.rainSmooth[i] = 0;
          state.rainDroplet[i] = 0;
          state.filterState[i] = 0;
        }
        postMessageFn({
          type: 'CONFIG_UPDATED',
          payload: { cutoffFrequency: state.currentCutoffHz },
        });
        break;
      }

      case 'SYNTHESIZE':
      case 'GENERATE_CHUNK': {
        const req = msg as SynthesizeAudioRequest;
        if (!req.noiseType || !['pink', 'brown', 'white', 'rain'].includes(req.noiseType)) {
          postMessageFn({
            type: 'ERROR',
            payload: { message: `Unsupported or missing noise type: ${req.noiseType}` },
          });
          return;
        }

        const { channelBuffers, sampleRate, channels } = synthesizeSoundscapeBuffers(
          req,
          state
        );

        // Extract transferable ArrayBuffers
        const transferBuffers: ArrayBuffer[] = channelBuffers.map(
          (cb) => cb.buffer
        );

        postMessageFn(
          {
            type: msg.type === 'GENERATE_CHUNK' ? 'CHUNK_READY' : 'SYNTHESIZED',
            payload: {
              noiseType: req.noiseType,
              sampleRate,
              channels,
              length: channelBuffers[0].length,
              cutoffFrequency: state.currentCutoffHz,
              buffers: transferBuffers,
            },
          },
          transferBuffers
        );
        break;
      }

      default:
        postMessageFn({
          type: 'ERROR',
          payload: { message: `Unknown message type: ${(msg as any).type}` },
        });
        break;
    }
  } catch (err: any) {
    postMessageFn({
      type: 'ERROR',
      payload: { message: err?.message || 'Internal worker synthesis error' },
    });
  }
}

// Global state in worker scope
const globalWorkerState: NoiseGeneratorState = {
  pinkState: [],
  brownState: [],
  rainSmooth: [],
  rainDroplet: [],
  filterState: [],
  currentCutoffHz: 12000,
};

// Wire message listener when in a worker context
if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = (event: MessageEvent<AudioWorkerMessage>) => {
    handleWorkerMessage(event.data, globalWorkerState, (resp, transfer) => {
      self.postMessage(resp, transfer as any);
    });
  };
}
