import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  createNoiseSampleBuffer,
  loadSoundscapePresets,
  NoiseSoundscapeEngine,
  saveSoundscapePresets,
} from '@/lib/audio/noiseSynthesizer';
import { AmbientSoundGenerator } from '@/components/audio/AmbientSoundGenerator';

describe('Multi-Layer Web Audio Soundscape Mixer & Presets', () => {
  it('generates deterministic noise buffers for white, pink, and rain layers', () => {
    const whiteA = createNoiseSampleBuffer(1000, 0.1, 'white', 7);
    const whiteB = createNoiseSampleBuffer(1000, 0.1, 'white', 7);
    const pink = createNoiseSampleBuffer(1000, 0.1, 'pink', 7);
    const rain = createNoiseSampleBuffer(1000, 0.1, 'rain', 7);

    expect(whiteA).toEqual(whiteB);
    expect(pink.length).toBe(100);
    expect(rain.length).toBe(100);
  });

  it('pauses on visibility change or mute and handles storage quota errors gracefully', async () => {
    const setTargetAtTime = jest.fn();
    const suspend = jest.fn().mockResolvedValue(undefined);
    const close = jest.fn().mockResolvedValue(undefined);

    const engine = new NoiseSoundscapeEngine({
      currentTime: 2.5,
      suspend,
      close,
      createGain: () => ({
        gain: { value: 0.5, setTargetAtTime },
        connect: jest.fn(),
      }),
    });

    await engine.start();
    expect(engine.getState().isPlaying).toBe(true);

    engine.setLayerGain('rain', 0.8);
    expect(engine.getState().layers.rain).toBe(0.8);
    expect(setTargetAtTime).toHaveBeenCalled();

    await engine.handleVisibilityChange(true);
    expect(engine.getState().isPlaying).toBe(false);
    expect(suspend).toHaveBeenCalledTimes(1);

    const throwingStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const saved = saveSoundscapePresets(
      [
        {
          id: 'p1',
          name: 'Test',
          masterGain: 0.5,
          layers: { white: 0.1, pink: 0.2, rain: 0.3 },
        },
      ],
      throwingStorage
    );
    expect(saved).toBe(false);
    expect(loadSoundscapePresets(throwingStorage)).toHaveLength(1);

    await engine.dispose();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('renders AmbientSoundGenerator and updates play/mute state on click', async () => {
    render(<AmbientSoundGenerator storage={null} />);

    fireEvent.click(screen.getByTestId('toggle-play-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('soundscape-status').textContent).toContain(
        'Playing'
      );
    });

    fireEvent.click(screen.getByTestId('toggle-mute-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('soundscape-status').textContent).toContain(
        'Muted'
      );
    });
  });

  it('defers AudioContext resume until first user interaction to avoid autoplay warnings', async () => {
    const resume = jest.fn().mockResolvedValue(undefined);
    const mockCtx = {
      state: 'suspended',
      resume,
      createGain: () => ({
        gain: { value: 1, setTargetAtTime: jest.fn() },
        connect: jest.fn(),
      }),
    };

    render(<AmbientSoundGenerator storage={null} audioContext={mockCtx} />);

    // On initial mount, AudioContext remains suspended and resume is NOT called
    expect(resume).not.toHaveBeenCalled();
    expect(screen.getByTestId('soundscape-status').textContent).toContain('Paused');

    // Upon first user click, resume is called and audio playback begins immediately
    fireEvent.click(screen.getByTestId('toggle-play-btn'));
    await waitFor(() => {
      expect(resume).toHaveBeenCalled();
      expect(screen.getByTestId('soundscape-status').textContent).toContain('Playing');
    });
  });

  it('toggles master mute with smooth ramp, preserves slider value, and shows visual indicator', async () => {
    const setTargetAtTime = jest.fn();
    const mockCtx = {
      currentTime: 1.0,
      state: 'running',
      createGain: () => ({
        gain: { value: 0.6, setTargetAtTime },
        connect: jest.fn(),
      }),
    };

    render(<AmbientSoundGenerator storage={null} audioContext={mockCtx} />);

    const muteBtn = screen.getByTestId('toggle-mute-btn');
    const masterSlider = screen.getByTestId('master-gain-slider') as HTMLInputElement;

    expect(masterSlider.value).toBe('0.6');
    expect(muteBtn.textContent).toContain('Mute');
    expect(muteBtn).toHaveAttribute('aria-pressed', 'false');

    // Click mute
    fireEvent.click(muteBtn);
    await waitFor(() => {
      expect(screen.getByTestId('soundscape-status').textContent).toContain('Muted');
    });
    expect(muteBtn.textContent).toContain('Unmute');
    expect(muteBtn).toHaveAttribute('aria-pressed', 'true');
    // Gain ramped to 0 smoothly over 50ms
    expect(setTargetAtTime).toHaveBeenCalledWith(0, expect.any(Number), expect.any(Number));
    // Slider value remains preserved at 0.6
    expect(masterSlider.value).toBe('0.6');

    // Click unmute
    fireEvent.click(muteBtn);
    await waitFor(() => {
      expect(screen.getByTestId('soundscape-status').textContent).not.toContain('Muted');
    });
    expect(muteBtn.textContent).toContain('Mute');
    expect(muteBtn).toHaveAttribute('aria-pressed', 'false');
    // Master gain is restored
    expect(setTargetAtTime).toHaveBeenCalledWith(0.6, expect.any(Number), expect.any(Number));
    expect(masterSlider.value).toBe('0.6');
  });
});
