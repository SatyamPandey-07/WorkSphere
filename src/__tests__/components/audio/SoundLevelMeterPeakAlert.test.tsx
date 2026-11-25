import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  NOISE_ALERT_PREFS_STORAGE_KEY,
  SoundLevelMeter,
} from '@/components/audio/SoundLevelMeter';
import { NoiseLevelSlider } from '@/components/venues/NoiseLevelSlider';

describe('SoundLevelMeter & NoiseLevelSlider Peak Noise Alert Toast (#9609)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not trigger toast for transient spikes under 3 consecutive seconds', () => {
    const onViolation = jest.fn();
    const { rerender } = render(
      <SoundLevelMeter decibels={70} onThresholdViolation={onViolation} />
    );

    act(() => {
      jest.advanceTimersByTime(2500);
    });
    expect(screen.queryByTestId('noise-peak-alert-toast')).not.toBeInTheDocument();

    // Drops back below 65 dBA before 3 seconds complete
    rerender(<SoundLevelMeter decibels={60} onThresholdViolation={onViolation} />);
    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(screen.queryByTestId('noise-peak-alert-toast')).not.toBeInTheDocument();
    expect(onViolation).not.toHaveBeenCalled();
  });

  it('triggers accessible toast after decibels exceed 65 dBA for 3 consecutive seconds despite fluctuations', () => {
    const onViolation = jest.fn();
    const { rerender } = render(
      <SoundLevelMeter decibels={68} onThresholdViolation={onViolation} />
    );

    act(() => {
      jest.advanceTimersByTime(1500);
    });
    expect(screen.queryByTestId('noise-peak-alert-toast')).not.toBeInTheDocument();

    // Fluctuating value still above threshold should not reset the 3s debounce window
    rerender(<SoundLevelMeter decibels={74.5} onThresholdViolation={onViolation} />);
    act(() => {
      jest.advanceTimersByTime(1499);
    });
    expect(screen.queryByTestId('noise-peak-alert-toast')).not.toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1);
    });

    const toast = screen.getByTestId('noise-peak-alert-toast');
    expect(toast).toHaveAttribute('role', 'status');
    expect(toast).toHaveAttribute('aria-live', 'polite');
    expect(toast).toHaveTextContent('74.5 dBA');
    expect(onViolation).toHaveBeenCalledWith(74.5, 65);
  });

  it('allows dismissing the toast and muting warnings or customizing threshold', () => {
    const { rerender } = render(<SoundLevelMeter decibels={70} />);

    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(screen.getByTestId('noise-peak-alert-toast')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('dismiss-noise-toast-btn'));
    expect(screen.queryByTestId('noise-peak-alert-toast')).not.toBeInTheDocument();

    // Re-arms after falling below threshold and rising again
    rerender(<SoundLevelMeter decibels={50} />);
    fireEvent.change(screen.getByTestId('noise-alert-threshold-input'), {
      target: { value: '55' },
    });
    rerender(<SoundLevelMeter decibels={58} />);

    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(screen.getByTestId('noise-peak-alert-toast')).toBeInTheDocument();

    // Muting hides active toast and persists preference
    fireEvent.click(screen.getByTestId('mute-noise-alerts-btn'));
    expect(screen.queryByTestId('noise-peak-alert-toast')).not.toBeInTheDocument();
    expect(screen.getByTestId('mute-noise-alerts-btn')).toHaveAttribute('aria-pressed', 'true');

    const stored = JSON.parse(localStorage.getItem(NOISE_ALERT_PREFS_STORAGE_KEY) || '{}');
    expect(stored).toEqual({ thresholdDb: 55, muted: true });
  });

  it('exposes peak alert threshold and mute preference controls in NoiseLevelSlider', () => {
    const onRangeChange = jest.fn();
    const onAlertPrefsChange = jest.fn();

    render(
      <NoiseLevelSlider
        onChange={onRangeChange}
        onAlertPreferencesChange={onAlertPrefsChange}
      />
    );

    const thresholdInput = screen.getByTestId('slider-noise-alert-threshold');
    fireEvent.change(thresholdInput, { target: { value: '70' } });
    expect(onAlertPrefsChange).toHaveBeenCalledWith({ thresholdDb: 70, muted: false });

    const muteBtn = screen.getByTestId('slider-mute-noise-alerts-btn');
    fireEvent.click(muteBtn);
    expect(onAlertPrefsChange).toHaveBeenLastCalledWith({ thresholdDb: 70, muted: true });
    expect(muteBtn).toHaveAttribute('aria-pressed', 'true');
  });
});
