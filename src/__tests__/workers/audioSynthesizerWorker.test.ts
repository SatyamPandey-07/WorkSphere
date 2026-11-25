/**
 * @file audioSynthesizerWorker.test.ts
 * @description Focused unit tests for multi-threaded Web Worker audio synthesis
 * of binaural soundscapes (Issue #10115).
 */

import {
  generatePinkNoiseChannel,
  generateBrownNoiseChannel,
  generateWhiteNoiseChannel,
  generateRainChannel,
  applySmoothCutoffFilter,
  synthesizeSoundscapeBuffers,
  handleWorkerMessage,
  type NoiseGeneratorState,
  type AudioWorkerResponse,
  type SynthesizedAudioPayload,
} from '@/workers/audioSynthesizerWorker';

describe('audioSynthesizerWorker (#10115)', () => {
  let sampleRate: number;

  beforeEach(() => {
    sampleRate = 44100;
  });

  describe('1 & 4. Correct generation and structure of Float32 audio buffers', () => {
    it('generates Float32Array buffers with correct length and channel count', () => {
      const { channelBuffers, sampleRate: sr, channels } = synthesizeSoundscapeBuffers({
        type: 'SYNTHESIZE',
        noiseType: 'pink',
        channels: 2,
        bufferSize: 1024,
        sampleRate: 48000,
      });

      expect(channels).toBe(2);
      expect(sr).toBe(48000);
      expect(channelBuffers).toHaveLength(2);
      expect(channelBuffers[0]).toBeInstanceOf(Float32Array);
      expect(channelBuffers[1]).toBeInstanceOf(Float32Array);
      expect(channelBuffers[0].length).toBe(1024);
      expect(channelBuffers[1].length).toBe(1024);
    });

    it('generates multi-channel binaural buffers with separate channel data', () => {
      const { channelBuffers } = synthesizeSoundscapeBuffers({
        type: 'SYNTHESIZE',
        noiseType: 'brown',
        channels: 2,
        bufferSize: 256,
      });

      expect(channelBuffers).toHaveLength(2);
      // Verify channels are separate buffers in memory
      expect(channelBuffers[0].buffer).not.toBe(channelBuffers[1].buffer);
    });
  });

  describe('2. Pink noise generation produces valid finite samples', () => {
    it('generates bounded, finite pink noise samples with 1/f Kellet filter', () => {
      const state = { b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0 };
      const length = 2048;
      const samples = generatePinkNoiseChannel(length, state);

      expect(samples).toHaveLength(length);
      for (let i = 0; i < length; i++) {
        expect(Number.isFinite(samples[i])).toBe(true);
        expect(samples[i]).toBeGreaterThanOrEqual(-1.0);
        expect(samples[i]).toBeLessThanOrEqual(1.0);
      }
      // Internal filter state should be updated
      expect(state.b0).not.toBe(0);
    });
  });

  describe('3. Brown noise generation produces valid finite samples', () => {
    it('generates integrated Brownian noise samples bounded in [-1, 1]', () => {
      const state = { lastOut: 0 };
      const length = 2048;
      const samples = generateBrownNoiseChannel(length, state);

      expect(samples).toHaveLength(length);
      for (let i = 0; i < length; i++) {
        expect(Number.isFinite(samples[i])).toBe(true);
        expect(samples[i]).toBeGreaterThanOrEqual(-1.0);
        expect(samples[i]).toBeLessThanOrEqual(1.0);
      }
      expect(state.lastOut).toBeDefined();
    });
  });

  describe('White and rain noise generators', () => {
    it('generates valid white and rain procedural textures', () => {
      const white = generateWhiteNoiseChannel(512);
      expect(white).toHaveLength(512);
      for (let i = 0; i < 512; i++) {
        expect(Number.isFinite(white[i])).toBe(true);
      }

      const rainState = { smooth: 0, dropletEnv: 0 };
      const rain = generateRainChannel(512, sampleRate, rainState);
      expect(rain).toHaveLength(512);
      for (let i = 0; i < 512; i++) {
        expect(Number.isFinite(rain[i])).toBe(true);
        expect(rain[i]).toBeGreaterThanOrEqual(-1.0);
        expect(rain[i]).toBeLessThanOrEqual(1.0);
      }
    });
  });

  describe('5. Smooth frequency cutoff filtering', () => {
    it('applies low-pass filter without discontinuities or non-finite values', () => {
      const samples = new Float32Array(512).fill(0.8);
      const filterRef = { lastSample: 0 };

      applySmoothCutoffFilter(samples, sampleRate, 10000, 1000, filterRef);

      expect(samples).toHaveLength(512);
      for (let i = 0; i < 512; i++) {
        expect(Number.isFinite(samples[i])).toBe(true);
      }
      expect(filterRef.lastSample).toBeCloseTo(samples[511], 3);
    });

    it('smoothly attenuates high-frequency content when cutoff is lowered', () => {
      // Alternating Nyquist pattern: +1, -1, +1, -1
      const highFreq = new Float32Array(100);
      for (let i = 0; i < 100; i++) highFreq[i] = i % 2 === 0 ? 1 : -1;

      const filterRef = { lastSample: 0 };
      applySmoothCutoffFilter(highFreq, sampleRate, 500, 500, filterRef);

      // Lowpass filtered output should have drastically attenuated amplitude
      const lastVal = Math.abs(highFreq[99]);
      expect(lastVal).toBeLessThan(0.15);
    });
  });

  describe('6 & 7. Worker message protocol and transferable ArrayBuffers', () => {
    let mockWorkerState: NoiseGeneratorState;
    let postedResponses: { response: AudioWorkerResponse; transfer?: Transferable[] }[];

    beforeEach(() => {
      mockWorkerState = {
        pinkState: [],
        brownState: [],
        rainSmooth: [],
        rainDroplet: [],
        filterState: [],
        currentCutoffHz: 12000,
      };
      postedResponses = [];
    });

    const mockPostMessage = (response: AudioWorkerResponse, transfer?: Transferable[]) => {
      postedResponses.push({ response, transfer });
    };

    it('handles SYNTHESIZE request and transfers channel ArrayBuffers', () => {
      handleWorkerMessage(
        {
          type: 'SYNTHESIZE',
          noiseType: 'pink',
          channels: 2,
          bufferSize: 512,
          sampleRate: 44100,
        },
        mockWorkerState,
        mockPostMessage
      );

      expect(postedResponses).toHaveLength(1);
      const { response, transfer } = postedResponses[0];
      expect(response.type).toBe('SYNTHESIZED');

      const payload = response.payload as SynthesizedAudioPayload;
      expect(payload.noiseType).toBe('pink');
      expect(payload.channels).toBe(2);
      expect(payload.buffers).toHaveLength(2);
      expect(transfer).toBeDefined();
      expect(transfer).toHaveLength(2);
      expect(transfer![0]).toBe(payload.buffers[0]);
      expect(transfer![1]).toBe(payload.buffers[1]);
    });

    it('handles GENERATE_CHUNK request with CHUNK_READY response', () => {
      handleWorkerMessage(
        {
          type: 'GENERATE_CHUNK',
          noiseType: 'brown',
          channels: 1,
          bufferSize: 256,
        },
        mockWorkerState,
        mockPostMessage
      );

      expect(postedResponses).toHaveLength(1);
      expect(postedResponses[0].response.type).toBe('CHUNK_READY');
      const payload = postedResponses[0].response.payload as SynthesizedAudioPayload;
      expect(payload.noiseType).toBe('brown');
      expect(payload.channels).toBe(1);
    });

    it('handles SET_CUTOFF message and updates generator state', () => {
      handleWorkerMessage(
        {
          type: 'SET_CUTOFF',
          cutoffFrequency: 4500,
        },
        mockWorkerState,
        mockPostMessage
      );

      expect(mockWorkerState.currentCutoffHz).toBe(4500);
      expect(postedResponses).toHaveLength(1);
      expect(postedResponses[0].response.type).toBe('CONFIG_UPDATED');
    });

    it('handles RESET message and clears internal states', () => {
      mockWorkerState.brownState = [0.5, -0.3];
      handleWorkerMessage(
        {
          type: 'RESET',
        },
        mockWorkerState,
        mockPostMessage
      );

      expect(mockWorkerState.brownState[0]).toBe(0);
      expect(mockWorkerState.brownState[1]).toBe(0);
      expect(postedResponses[0].response.type).toBe('CONFIG_UPDATED');
    });
  });

  describe('8 & 9. Safe handling of invalid inputs and worker errors', () => {
    let mockWorkerState: NoiseGeneratorState;
    let postedResponses: { response: AudioWorkerResponse; transfer?: Transferable[] }[];

    beforeEach(() => {
      mockWorkerState = {
        pinkState: [],
        brownState: [],
        rainSmooth: [],
        rainDroplet: [],
        filterState: [],
        currentCutoffHz: 12000,
      };
      postedResponses = [];
    });

    const mockPostMessage = (response: AudioWorkerResponse, transfer?: Transferable[]) => {
      postedResponses.push({ response, transfer });
    };

    it('rejects null or non-object message payloads safely', () => {
      handleWorkerMessage(null, mockWorkerState, mockPostMessage);
      expect(postedResponses[0].response.type).toBe('ERROR');

      handleWorkerMessage('invalid string', mockWorkerState, mockPostMessage);
      expect(postedResponses[1].response.type).toBe('ERROR');
    });

    it('rejects unsupported noise types with descriptive error', () => {
      handleWorkerMessage(
        {
          type: 'SYNTHESIZE',
          noiseType: 'alien_frequency' as any,
        },
        mockWorkerState,
        mockPostMessage
      );

      expect(postedResponses[0].response.type).toBe('ERROR');
      expect((postedResponses[0].response.payload as any).message).toContain(
        'Unsupported or missing noise type'
      );
    });

    it('rejects non-positive cutoff frequencies safely', () => {
      handleWorkerMessage(
        {
          type: 'SET_CUTOFF',
          cutoffFrequency: -50,
        },
        mockWorkerState,
        mockPostMessage
      );

      expect(postedResponses[0].response.type).toBe('ERROR');
      expect((postedResponses[0].response.payload as any).message).toContain(
        'Invalid cutoff frequency'
      );
    });

    it('rejects unknown message types gracefully without throwing', () => {
      handleWorkerMessage(
        {
          type: 'UNKNOWN_OPCODE' as any,
        },
        mockWorkerState,
        mockPostMessage
      );

      expect(postedResponses[0].response.type).toBe('ERROR');
    });
  });

  describe('10. AudioWorklet fallback behavior', () => {
    it('synthesizes soundscape buffers synchronously on main thread when worker is unavailable', () => {
      const { channelBuffers, sampleRate: sr, channels } = synthesizeSoundscapeBuffers({
        type: 'SYNTHESIZE',
        noiseType: 'brown',
        durationSeconds: 1,
        sampleRate: 22050,
        channels: 2,
        cutoffFrequency: 5000,
      });

      expect(sr).toBe(22050);
      expect(channels).toBe(2);
      expect(channelBuffers).toHaveLength(2);
      expect(channelBuffers[0].length).toBe(22050);
      expect(Number.isFinite(channelBuffers[0][100])).toBe(true);
    });
  });
});
