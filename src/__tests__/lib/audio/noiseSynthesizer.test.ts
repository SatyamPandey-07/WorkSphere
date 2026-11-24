import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  generateNoiseSamples,
  NoiseSynthesizer,
  type AudioContextLike,
} from '@/lib/audio/noiseSynthesizer';
import { AmbientSoundGenerator } from '@/components/audio/AmbientSoundGenerator';

function createMockAudioContext() {
  const gainNode = {
    gain: {
      value: 1,
      setTargetAtTime: jest.fn((val: number) => {
        gainNode.gain.value = val;
      }),
    },
    connect: jest.fn(),
    disconnect: jest.fn(),
  };

  const filterNode = {
    type: 'allpass' as BiquadFilterType,
    frequency: { value: 1000 },
    connect: jest.fn(),
    disconnect: jest.fn(),
  };

  const sourceNode = {
    buffer: null as AudioBuffer | null,
    loop: false,
    connect: jest.fn(),
    disconnect: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
  };

  const ctx: AudioContextLike & {
    _gainNode: typeof gainNode;
    _filterNode: typeof filterNode;
    _sourceNode: typeof sourceNode;
  } = {
    sampleRate: 44100,
    currentTime: 0,
    state: 'running',
    destination: {} as AudioNode,
    createBuffer: jest.fn((_channels: number, length: number, sampleRate: number) => {
      const channelData = new Float32Array(length);
      return {
        length,
        sampleRate,
        numberOfChannels: 1,
        duration: length / sampleRate,
        getChannelData: () => channelData,
        copyToChannel: (src: Float32Array) => channelData.set(src),
      } as unknown as AudioBuffer;
    }),
    createBufferSource: jest.fn(() => sourceNode as unknown as AudioBufferSourceNode),
    createBiquadFilter: jest.fn(() => filterNode as unknown as BiquadFilterNode),
    createGain: jest.fn(() => gainNode as unknown as GainNode),
    resume: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    _gainNode: gainNode,
    _filterNode: filterNode,
    _sourceNode: sourceNode,
  };

  return ctx;
}

describe('NoiseSynthesizer & AmbientSoundGenerator', () => {
  it('generates bounded samples for white, pink, and rain presets', () => {
    for (const type of ['white', 'pink', 'rain'] as const) {
      const samples = generateNoiseSamples(type, 512, 44100);
      expect(samples).toHaveLength(512);
      for (let i = 0; i < samples.length; i += 1) {
        expect(samples[i]).toBeGreaterThanOrEqual(-1);
        expect(samples[i]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('wires Web Audio nodes, attenuates volume, and pauses when tab becomes hidden or muted', async () => {
    const mockCtx = createMockAudioContext();
    const synth = new NoiseSynthesizer({
      soundType: 'rain',
      volume: 0.75,
      bufferDurationSeconds: 1,
      audioContextFactory: () => mockCtx,
    });

    await synth.play();
    expect(mockCtx.createBufferSource).toHaveBeenCalledTimes(1);
    expect(mockCtx.createBiquadFilter).toHaveBeenCalledTimes(1);
    expect(mockCtx.createGain).toHaveBeenCalledTimes(1);
    expect(mockCtx._sourceNode.connect).toHaveBeenCalledWith(mockCtx._filterNode);
    expect(mockCtx._filterNode.connect).toHaveBeenCalledWith(mockCtx._gainNode);
    expect(mockCtx._gainNode.connect).toHaveBeenCalledWith(mockCtx.destination);
    expect(mockCtx._gainNode.gain.value).toBeCloseTo(0.75, 2);

    synth.setVolume(0.2);
    expect(mockCtx._gainNode.gain.value).toBeCloseTo(0.2, 2);

    Object.defineProperty(document, 'hidden', {
      value: true,
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(synth.getState().isPlaying).toBe(false);
    expect(mockCtx._sourceNode.stop).toHaveBeenCalled();

    Object.defineProperty(document, 'hidden', {
      value: false,
      configurable: true,
    });
    await synth.play();
    expect(synth.getState().isPlaying).toBe(true);

    synth.setMuted(true);
    expect(synth.getState().isPlaying).toBe(false);
    expect(mockCtx._gainNode.gain.value).toBe(0);

    await synth.dispose();
  });

  it('renders play/pause toggle, sound presets, and volume slider in AmbientSoundGenerator', async () => {
    const mockCtx = createMockAudioContext();
    (window as unknown as { AudioContext: unknown }).AudioContext = jest
      .fn()
      .mockImplementation(() => mockCtx);

    render(<AmbientSoundGenerator initialSound="pink" initialVolume={0.5} />);

    const playBtn = screen.getByTestId('ambient-play-toggle-btn');
    await act(async () => {
      fireEvent.click(playBtn);
    });
    expect(playBtn.textContent).toBe('Pause');

    const slider = screen.getByTestId('ambient-volume-slider');
    fireEvent.change(slider, { target: { value: '80' } });
    expect(screen.getByTestId('ambient-volume-value').textContent).toBe('80%');
  });
});
