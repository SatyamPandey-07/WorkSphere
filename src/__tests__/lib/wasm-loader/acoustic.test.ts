/**
 * acoustic.test.ts
 * Tests for WebAssembly acoustic fingerprinting worker fallback when SharedArrayBuffer is disabled (#5312).
 */

import {
  AcousticFingerprintLoader,
  isCrossOriginIsolated,
  isSharedArrayBufferSupported,
} from '@/lib/wasm-loader/acoustic';

describe('Acoustic WASM Loader & Worker SAB Fallback (#5312)', () => {
  const originalCrossOriginIsolated = (globalThis as any).crossOriginIsolated;
  const originalSharedArrayBuffer = (globalThis as any).SharedArrayBuffer;

  afterEach(() => {
    (globalThis as any).crossOriginIsolated = originalCrossOriginIsolated;
    (globalThis as any).SharedArrayBuffer = originalSharedArrayBuffer;
    jest.clearAllMocks();
  });

  describe('crossOriginIsolated & SharedArrayBuffer Environment Detection', () => {
    it('detects crossOriginIsolated browser environment correctly', () => {
      (globalThis as any).crossOriginIsolated = true;
      expect(isCrossOriginIsolated()).toBe(true);

      (globalThis as any).crossOriginIsolated = false;
      expect(isCrossOriginIsolated()).toBe(false);

      delete (globalThis as any).crossOriginIsolated;
      expect(isCrossOriginIsolated()).toBe(false);
    });

    it('verifies SharedArrayBuffer is only supported when crossOriginIsolated is true', () => {
      (globalThis as any).crossOriginIsolated = true;
      (globalThis as any).SharedArrayBuffer = ArrayBuffer;
      expect(isSharedArrayBufferSupported()).toBe(true);

      // When COOP/COEP headers are missing, crossOriginIsolated is false
      (globalThis as any).crossOriginIsolated = false;
      expect(isSharedArrayBufferSupported()).toBe(false);

      delete (globalThis as any).SharedArrayBuffer;
      expect(isSharedArrayBufferSupported()).toBe(false);
    });
  });

  describe('AcousticFingerprintLoader Execution Modes & Fallbacks', () => {
    it('returns shared-array-buffer mode when cross-origin isolation is enabled', () => {
      (globalThis as any).crossOriginIsolated = true;
      (globalThis as any).SharedArrayBuffer = ArrayBuffer;

      const loader = new AcousticFingerprintLoader({} as Worker);
      expect(loader.getExecutionMode()).toBe('shared-array-buffer');
    });

    it('returns transferable mode when SharedArrayBuffer is disabled due to missing COOP headers', () => {
      (globalThis as any).crossOriginIsolated = false;

      const loader = new AcousticFingerprintLoader({} as Worker);
      expect(loader.getExecutionMode()).toBe('transferable');
    });

    it('uses SharedArrayBuffer fast-path when supported without crashing', async () => {
      (globalThis as any).crossOriginIsolated = true;
      (globalThis as any).SharedArrayBuffer = ArrayBuffer;

      const postMessageSpy = jest.fn();
      const mockWorker = {
        postMessage: postMessageSpy,
        addEventListener: jest.fn((event: string, handler: (e: any) => void) => {
          if (event === 'message') {
            setTimeout(() => {
              handler({
                data: {
                  type: 'FINGERPRINT_RESULT',
                  payload: {
                    dominantBand: 'Mid',
                    dominantBandIndex: 3,
                    energies: { Mid: 0.8 },
                    sampleRate: 44100,
                  },
                },
              });
            }, 0);
          }
        }),
        removeEventListener: jest.fn(),
      } as unknown as Worker;

      const loader = new AcousticFingerprintLoader(mockWorker);
      const audioData = new Float32Array([0.1, 0.2, 0.3, 0.4]);

      const result = await loader.processAudio(audioData, 44100);

      expect(result.dominantBand).toBe('Mid');
      expect(postMessageSpy).toHaveBeenCalledTimes(1);
      const sentMessage = postMessageSpy.mock.calls[0][0];
      expect(sentMessage.type).toBe('PROCESS_AUDIO');
      expect(sentMessage.payload.sampleRate).toBe(44100);
      // In SAB mode, no transfer list is passed to postMessage
      expect(postMessageSpy.mock.calls[0][1]).toBeUndefined();
    });

    it('falls back to asynchronous transferable ArrayBuffer when SharedArrayBuffer is disabled', async () => {
      (globalThis as any).crossOriginIsolated = false;

      const postMessageSpy = jest.fn();
      const mockWorker = {
        postMessage: postMessageSpy,
        addEventListener: jest.fn((event: string, handler: (e: any) => void) => {
          if (event === 'message') {
            setTimeout(() => {
              handler({
                data: {
                  type: 'FINGERPRINT_RESULT',
                  payload: {
                    dominantBand: 'Bass',
                    dominantBandIndex: 1,
                    energies: { Bass: 0.9 },
                    sampleRate: 48000,
                  },
                },
              });
            }, 0);
          }
        }),
        removeEventListener: jest.fn(),
      } as unknown as Worker;

      const loader = new AcousticFingerprintLoader(mockWorker);
      const audioData = new Float32Array([0.5, 0.6, 0.7, 0.8]);

      const result = await loader.processAudio(audioData, 48000);

      expect(result.dominantBand).toBe('Bass');
      expect(postMessageSpy).toHaveBeenCalledTimes(1);
      // Transfer list contains transferable buffer
      expect(postMessageSpy.mock.calls[0][1]).toHaveLength(1);
      expect(postMessageSpy.mock.calls[0][1][0]).toBeInstanceOf(ArrayBuffer);
    });

    it('falls back to postMessage structured cloning if transferring fails without crashing audio analysis', async () => {
      (globalThis as any).crossOriginIsolated = false;

      let callCount = 0;
      const postMessageSpy = jest.fn((_message: any, transfer?: any[]) => {
        callCount++;
        if (transfer && transfer.length > 0) {
          // Simulate transfer failure (e.g. DataCloneError or detached buffer)
          throw new Error('DataCloneError: Transfer failed');
        }
      });

      const mockWorker = {
        postMessage: postMessageSpy,
        addEventListener: jest.fn((event: string, handler: (e: any) => void) => {
          if (event === 'message') {
            setTimeout(() => {
              handler({
                data: {
                  type: 'FINGERPRINT_RESULT',
                  payload: {
                    dominantBand: 'Brilliance',
                    dominantBandIndex: 6,
                    energies: { Brilliance: 0.95 },
                    sampleRate: 44100,
                  },
                },
              });
            }, 0);
          }
        }),
        removeEventListener: jest.fn(),
      } as unknown as Worker;

      const loader = new AcousticFingerprintLoader(mockWorker);
      const audioData = new Float32Array([0.01, 0.02, 0.03]);

      const result = await loader.processAudio(audioData, 44100);

      expect(result.dominantBand).toBe('Brilliance');
      // Called first with transfer (which threw), then fell back to structured clone without transfer
      expect(callCount).toBe(2);
      expect(postMessageSpy.mock.calls[1][1]).toBeUndefined();
    });

    it('handles worker error response gracefully', async () => {
      (globalThis as any).crossOriginIsolated = false;

      const mockWorker = {
        postMessage: jest.fn(),
        addEventListener: jest.fn((event: string, handler: (e: any) => void) => {
          if (event === 'message') {
            setTimeout(() => {
              handler({
                data: {
                  type: 'FINGERPRINT_ERROR',
                  error: 'WASM memory allocation failed',
                },
              });
            }, 0);
          }
        }),
        removeEventListener: jest.fn(),
      } as unknown as Worker;

      const loader = new AcousticFingerprintLoader(mockWorker);
      const audioData = new Float32Array([0.1]);

      await expect(loader.processAudio(audioData, 44100)).rejects.toThrow(
        'WASM memory allocation failed'
      );
    });
  });
});
