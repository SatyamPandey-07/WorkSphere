import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  generateNoiseSamples,
  NoiseSynthesizer,
  type AudioContextLike,
} from '@/lib/audio/noiseSynthesizer';
import { AmbientSoundGenerator } from '@/components/audio/AmbientSoundGenerator';

function createMockAudioContext() {
  const masterGain = {
    gain: {
      value: 1,
      setTargetAtTime: jest.fn((val: number) => {
        masterGain.gain.value = val;
      }),
    },
    connect: jest.fn(),
    disconnect: jest.fn(),
  };

  const makeGain = () => {
    const g = {
      gain: {
        value: 1,
        setTargetAtTime: jest.fn((val: number) => {
          g.gain.value = val;
        }),
      },
      connect: jest.fn(),
      disconnect: jest.fn(),
    };
    return g;
  };

  const makeFilter = () => ({
    type: 'allpass' as BiquadFilterType,
    frequency: {
      value: 1000,
      setTargetAtTime: jest.fn(),
    },
    connect: jest.fn(),
    disconnect: jest.fn(),
  });

  const makeSource = () => ({
    buffer: null as AudioBuffer | null,
    loop: false,
    connect: jest.fn(),
    disconnect: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
  });

  let gainCallCount = 0;

  const ctx: AudioContextLike & { _masterGain: typeof masterGain } = {
    sampleRate: 44100,
    currentTime: 0,
    state: 'running',
    destination: {} as AudioNode,
    createBuffer: jest.fn((_channels: number, length: number, sampleRate: number) => {
      const channelData = new Float32Array(length);
      return {
        length,
        sampleRate,
        numberOfChannels: _channels,
        duration: length / sampleRate,
        getChannelData: () => channelData,
        copyToChannel: (src: Float32Array) => channelData.set(src),
      } as unknown as AudioBuffer;
    }),
    createBufferSource: jest.fn(() => makeSource() as unknown as AudioBufferSourceNode),
    createBiquadFilter: jest.fn(() => makeFilter() as unknown as BiquadFilterNode),
    createGain: jest.fn(() => {
      gainCallCount += 1;
      if (gainCallCount === 1) return masterGain as unknown as GainNode;
      return makeGain() as unknown as GainNode;
    }),
    resume: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    _masterGain: masterGain,
  };

  return ctx;
}

describe('NoiseSynthesizer & AmbientSoundGenerator v3 mixer', () => {
  it('generates bounded samples for white, pink, brown, and rain presets', () => {
    for (const type of ['white', 'pink', 'brown', 'rain'] as const) {
      const samples = generateNoiseSamples(type, 512, 44100);
      expect(samples).toHaveLength(512);
      for (let i = 0; i < samples.length; i += 1) {
        expect(samples[i]).toBeGreaterThanOrEqual(-1);
        expect(samples[i]).toBeLessThanOrEqual(1);
        expect(Number.isFinite(samples[i])).toBe(true);
      }
    }
  });

  it('wires multi-layer graph, attenuates volume, updates cutoff, and pauses on tab hide or mute', async () => {
    const mockCtx = createMockAudioContext();
    const synth = new NoiseSynthesizer({
      soundType: 'rain',
      volume: 0.75,
      cutoffFrequency: 8000,
      layerLevels: { white: 0.2, pink: 0.3, brown: 0.4, rain: 0.9 },
      bufferDurationSeconds: 1,
      audioContextFactory: () => mockCtx,
      useWorker: false, // test Web Audio fallback path directly
    });

    await synth.play();
    expect(mockCtx.createBufferSource).toHaveBeenCalledTimes(4); // 4 layers
    expect(mockCtx.createBiquadFilter).toHaveBeenCalledTimes(5); // 4 layer filters + 1 master cutoff filter
    expect(mockCtx.createGain).toHaveBeenCalledTimes(5); // 1 master + 4 layers
    expect(mockCtx._masterGain.gain.value).toBeCloseTo(0.75, 2);

    synth.setVolume(0.25);
    expect(mockCtx._masterGain.gain.value).toBeCloseTo(0.25, 2);

    synth.setCutoffFrequency(6000);
    expect(synth.getState().cutoffFrequency).toBe(6000);

    Object.defineProperty(document, 'hidden', {
      value: true,
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(synth.getState().isPlaying).toBe(false);

    Object.defineProperty(document, 'hidden', {
      value: false,
      configurable: true,
    });
    await synth.play();
    synth.setMuted(true);
    expect(synth.getState().isPlaying).toBe(false);
    expect(mockCtx._masterGain.gain.value).toBe(0);

    await synth.dispose();
  });

  it('renders mixer controls, adjusts cutoff frequency slider, and safely handles storage quota errors', async () => {
    const mockCtx = createMockAudioContext();
    (window as unknown as { AudioContext: unknown }).AudioContext = jest
      .fn()
      .mockImplementation(() => mockCtx);

    const setItemSpy = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

    render(<AmbientSoundGenerator initialSound="pink" initialVolume={0.5} initialCutoff={10000} />);

    const playBtn = screen.getByTestId('ambient-play-toggle-btn');
    await act(async () => {
      fireEvent.click(playBtn);
    });
    expect(playBtn.textContent).toBe('Pause');

    // Test cutoff slider change
    const cutoffSlider = screen.getByTestId('ambient-cutoff-slider');
    fireEvent.change(cutoffSlider, {
      target: { value: '5000' },
    });
    expect(screen.getByTestId('ambient-cutoff-value').textContent).toBe('5.0kHz');

    // Test layer slider change
    fireEvent.change(screen.getByTestId('layer-slider-rain'), {
      target: { value: '65' },
    });
    expect(screen.getByTestId('ambient-sound-generator')).toBeTruthy();

    // Select brown noise option
    const brownOption = screen.getByTestId('sound-option-brown');
    fireEvent.click(brownOption);
    expect(brownOption.getAttribute('aria-pressed')).toBe('true');

    setItemSpy.mockRestore();
  });
});
