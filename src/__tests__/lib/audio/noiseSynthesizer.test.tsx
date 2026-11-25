import {
  createNoiseSampleBuffer,
  NoiseSynthesizer,
} from '@/lib/audio/noiseSynthesizer';

describe('NoiseSynthesizer workerFactory fallback handling', () => {
  it('falls back cleanly to synchronous buffer generation when workerFactory throws and sets isPlaying true', async () => {
    const throwingWorkerFactory = () => {
      throw new Error('Worker constructor blocked in restricted context');
    };

    const synth = new NoiseSynthesizer({
      workerFactory: throwingWorkerFactory,
      sampleRate: 1_000,
      durationSeconds: 0.05,
    });

    const started = await synth.start();
    const state = synth.getState();

    expect(started).toBe(true);
    expect(state.isPlaying).toBe(true);
    expect(state.usedMainThreadFallback).toBe(true);
    expect(state.hasGeneratedBuffers).toBe(true);

    await synth.dispose();
  });

  it('uses worker when workerFactory succeeds without falling back to main-thread buffers', async () => {
    const postMessage = jest.fn();
    const terminate = jest.fn();

    const synth = new NoiseSynthesizer({
      workerFactory: () => ({
        postMessage,
        terminate,
      }),
    });

    const started = await synth.start();
    const state = synth.getState();

    expect(started).toBe(true);
    expect(state.isPlaying).toBe(true);
    expect(state.usedMainThreadFallback).toBe(false);
    expect(state.hasGeneratedBuffers).toBe(false);
    expect(postMessage).toHaveBeenCalledTimes(1);

    await synth.dispose();
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it('produces deterministic sample arrays in createNoiseSampleBuffer', () => {
    const a = createNoiseSampleBuffer(2_000, 0.02, 'pink', 11);
    const b = createNoiseSampleBuffer(2_000, 0.02, 'pink', 11);
    expect(a).toEqual(b);
  });
});