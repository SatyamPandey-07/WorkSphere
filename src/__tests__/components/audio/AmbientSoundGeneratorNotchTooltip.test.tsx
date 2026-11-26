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

describe('AmbientSoundGenerator Notch Frequency Slider Tooltip (#10432)', () => {
  it('shows and hides the visual tooltip on focus, hover, and pointer interactions', () => {
    render(<AmbientSoundGenerator storage={null} audioContext={null} />);

    const slider = screen.getByTestId('notch-frequency-slider');
    const tooltip = screen.getByTestId('notch-frequency-tooltip');

    expect(tooltip).toHaveAttribute('data-visible', 'false');
    expect(tooltip).toHaveAttribute('aria-hidden', 'true');
    expect(tooltip.textContent).toContain('60 Hz');
    expect(tooltip.textContent).toContain('AC Hum');

    fireEvent.focus(slider);
    expect(tooltip).toHaveAttribute('data-visible', 'true');
    expect(tooltip).toHaveAttribute('aria-hidden', 'false');

    fireEvent.blur(slider);
    expect(tooltip).toHaveAttribute('data-visible', 'false');

    fireEvent.mouseEnter(slider.parentElement!);
    expect(tooltip).toHaveAttribute('data-visible', 'true');

    fireEvent.mouseLeave(slider.parentElement!);
    expect(tooltip).toHaveAttribute('data-visible', 'false');

    fireEvent.pointerDown(slider);
    expect(tooltip).toHaveAttribute('data-visible', 'true');

    fireEvent.pointerUp(slider);
    expect(tooltip).toHaveAttribute('data-visible', 'false');
  });

  it('updates tooltip frequency text, band hint, and thumb track position as slider moves', () => {
    render(<AmbientSoundGenerator storage={null} audioContext={null} />);

    const slider = screen.getByTestId('notch-frequency-slider') as HTMLInputElement;
    const tooltip = screen.getByTestId('notch-frequency-tooltip');

    fireEvent.focus(slider);
    fireEvent.change(slider, { target: { value: '240' } });

    expect(slider.value).toBe('240');
    expect(tooltip.textContent).toContain('240 Hz');
    expect(tooltip.textContent).toContain('HVAC / Rumble');
    expect(slider).toHaveAttribute('aria-valuetext', '240 Hz (HVAC / Rumble)');
    // (240 - 50) / (2000 - 50) * 100 ≈ 9.7435...%
    expect(tooltip.style.left).toMatch(/^9\.74/);

    fireEvent.change(slider, { target: { value: '1025' } });
    expect(tooltip.textContent).toContain('1025 Hz');
    expect(tooltip.textContent).toContain('High Whine');
    expect(tooltip.style.left).toBe('50%');
  });

  it('configures and cleans up Web Audio notch BiquadFilterNode when toggled', () => {
    const mockFilterNode = {
      type: 'lowpass',
      frequency: { value: 350, setTargetAtTime: jest.fn() },
      Q: { value: 1 },
      disconnect: jest.fn(),
    };
    const mockCtx = {
      currentTime: 1.5,
      state: 'running',
      createGain: () => ({
        gain: { value: 0.6, setTargetAtTime: jest.fn() },
        connect: jest.fn(),
        disconnect: jest.fn(),
      }),
      createBiquadFilter: jest.fn(() => mockFilterNode),
    };

    const { unmount } = render(
      <AmbientSoundGenerator storage={null} audioContext={mockCtx} />
    );

    const toggleBtn = screen.getByTestId('toggle-notch-btn');
    const slider = screen.getByTestId('notch-frequency-slider');

    expect(toggleBtn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-pressed', 'true');
    expect(mockCtx.createBiquadFilter).toHaveBeenCalledTimes(1);
    expect(mockFilterNode.type).toBe('notch');
    expect(mockFilterNode.frequency.setTargetAtTime).toHaveBeenCalledWith(60, 1.5, 0.02);
    expect(mockFilterNode.Q.value).toBe(10);

    fireEvent.change(slider, { target: { value: '480' } });
    expect(mockFilterNode.frequency.setTargetAtTime).toHaveBeenCalledWith(480, 1.5, 0.02);

    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-pressed', 'false');
    expect(mockFilterNode.disconnect).toHaveBeenCalledTimes(1);

    unmount();
  });
});
