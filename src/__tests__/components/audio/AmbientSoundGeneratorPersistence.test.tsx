import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { AmbientSoundGenerator } from '@/components/audio/AmbientSoundGenerator';
import { SOUNDSCAPE_PREFERENCES_STORAGE_KEY } from '@/hooks/useSoundscapePreferences';

// Mock noiseSynthesizer so that test suite is not broken by pre-existing upstream syntax errors in noiseSynthesizer.ts
jest.mock('@/lib/audio/noiseSynthesizer', () => ({
  DEFAULT_SOUNDSCAPE_PRESET: {
    id: 'nomad-focus',
    name: 'Nomad Focus',
    masterGain: 0.6,
    layers: {
      white: 0.15,
      pink: 0.45,
      rain: 0.55,
    },
  },
  loadSoundscapePresets: jest.fn(() => [
    {
      id: 'nomad-focus',
      name: 'Nomad Focus',
      masterGain: 0.6,
      layers: {
        white: 0.15,
        pink: 0.45,
        rain: 0.55,
      },
    },
  ]),
  saveSoundscapePresets: jest.fn(),
  NoiseSoundscapeEngine: jest.fn().mockImplementation(() => ({
    applyPreset: jest.fn(),
    start: jest.fn().mockResolvedValue(true),
    pause: jest.fn().mockResolvedValue(undefined),
    setMuted: jest.fn().mockResolvedValue(undefined),
    setMasterGain: jest.fn(),
    setLayerGain: jest.fn((_layer, val) => val),
    handleVisibilityChange: jest.fn().mockResolvedValue(undefined),
    dispose: jest.fn().mockResolvedValue(undefined),
  })),
}));

describe('AmbientSoundGenerator Volume Persistence Integration', () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    jest.useFakeTimers();
    mockStorage = {};

    const storageMock: Storage = {
      getItem: jest.fn((key: string) => mockStorage[key] ?? null),
      setItem: jest.fn((key: string, value: string) => {
        mockStorage[key] = value;
      }),
      removeItem: jest.fn((key: string) => {
        delete mockStorage[key];
      }),
      clear: jest.fn(() => {
        mockStorage = {};
      }),
      key: jest.fn((i: number) => Object.keys(mockStorage)[i] ?? null),
      length: 0,
    };

    Object.defineProperty(window, 'localStorage', {
      value: storageMock,
      writable: true,
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('restoring preferences does not automatically start audio playback', () => {
    const saved = { brown: 35, cafe: 65, rain: 80 };
    window.localStorage.setItem(SOUNDSCAPE_PREFERENCES_STORAGE_KEY, JSON.stringify(saved));

    const mockCtx = {
      currentTime: 0,
      state: 'suspended',
      resume: jest.fn(),
      createGain: () => ({
        gain: { value: 0.6, setTargetAtTime: jest.fn() },
        connect: jest.fn(),
      }),
    };

    render(<AmbientSoundGenerator storage={null} audioContext={mockCtx} />);

    // Playback state must remain paused on initial render with restored preferences
    expect(screen.getByTestId('soundscape-status').textContent).toContain('Paused');
    expect(mockCtx.resume).not.toHaveBeenCalled();

    // Check slider values match restored preferences
    const brownSlider = screen.getByTestId('soundscape-slider-brown') as HTMLInputElement;
    const cafeSlider = screen.getByTestId('soundscape-slider-cafe') as HTMLInputElement;
    const rainSlider = screen.getByTestId('soundscape-slider-rain') as HTMLInputElement;

    expect(brownSlider.value).toBe('35');
    expect(cafeSlider.value).toBe('65');
    expect(rainSlider.value).toBe('80');
  });

  it('changing a slider immediately updates UI and debounces persistence to localStorage', () => {
    render(<AmbientSoundGenerator storage={null} audioContext={null} />);

    const brownSlider = screen.getByTestId('soundscape-slider-brown') as HTMLInputElement;
    expect(brownSlider.value).toBe('50');

    // Change slider
    fireEvent.change(brownSlider, { target: { value: '72' } });

    // In-memory UI updates immediately
    expect(brownSlider.value).toBe('72');
    expect(window.localStorage.getItem(SOUNDSCAPE_PREFERENCES_STORAGE_KEY)).toBeNull();

    // Debounce advances by 300ms
    jest.advanceTimersByTime(300);

    const saved = JSON.parse(window.localStorage.getItem(SOUNDSCAPE_PREFERENCES_STORAGE_KEY)!);
    expect(saved.brown).toBe(72);
  });
});
