import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { AmbientSoundGenerator } from '@/components/audio/AmbientSoundGenerator';

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

describe('AmbientSoundGenerator Acoustic Notch Keyboard Shortcut (#10437)', () => {
  it('toggles the acoustic notch filter on lowercase and uppercase N keydown and exposes aria-keyshortcuts', () => {
    render(<AmbientSoundGenerator storage={null} audioContext={null} />);

    const toggleBtn = screen.getByTestId('toggle-notch-btn');
    expect(toggleBtn).toHaveAttribute('aria-pressed', 'false');
    expect(toggleBtn).toHaveAttribute('aria-keyshortcuts', 'n');

    fireEvent.keyDown(window, { key: 'n' });
    expect(toggleBtn).toHaveAttribute('aria-pressed', 'true');

    fireEvent.keyDown(window, { key: 'N' });
    expect(toggleBtn).toHaveAttribute('aria-pressed', 'false');
  });

  it('ignores modifier combinations, key repeats, and editable inputs', () => {
    render(
      <div>
        <input type="text" data-testid="unrelated-text-input" />
        <textarea data-testid="unrelated-textarea" />
        <AmbientSoundGenerator storage={null} audioContext={null} />
      </div>
    );

    const toggleBtn = screen.getByTestId('toggle-notch-btn');
    const textInput = screen.getByTestId('unrelated-text-input');
    const textarea = screen.getByTestId('unrelated-textarea');

    fireEvent.keyDown(window, { key: 'n', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'n', metaKey: true });
    fireEvent.keyDown(window, { key: 'n', altKey: true });
    fireEvent.keyDown(window, { key: 'n', repeat: true });
    fireEvent.keyDown(textInput, { key: 'n' });
    fireEvent.keyDown(textarea, { key: 'n' });

    expect(toggleBtn).toHaveAttribute('aria-pressed', 'false');

    // Range sliders inside the panel should still allow toggling via N
    const slider = screen.getByTestId('notch-frequency-slider');
    fireEvent.keyDown(slider, { key: 'n' });
    expect(toggleBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('detaches the keydown listener on unmount', () => {
    const addSpy = jest.spyOn(window, 'addEventListener');
    const removeSpy = jest.spyOn(window, 'removeEventListener');

    const { unmount } = render(<AmbientSoundGenerator storage={null} audioContext={null} />);
    const registered = addSpy.mock.calls.find(([eventName]) => eventName === 'keydown')?.[1];
    expect(registered).toBeDefined();

    unmount();
    expect(removeSpy).toHaveBeenCalledWith('keydown', registered);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
