import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  calculateJitterMs,
  classifyJitterTier,
  summarizePingTelemetry,
} from '@/lib/wifi/jitter';
import { VenueWifiStats } from '@/components/venues/VenueWifiStats';

describe('jitter calculation and WiFi stability gauge', () => {
  it('returns 0ms jitter for empty, single-sample, or flat ping arrays', () => {
    expect(calculateJitterMs([])).toBe(0);
    expect(calculateJitterMs([24])).toBe(0);
    expect(calculateJitterMs([18, 18, 18, 18])).toBe(0);
  });

  it('captures spike outliers accurately across consecutive ping samples', () => {
    const jitter = calculateJitterMs([18, 20, 140, 19, 21]);
    expect(jitter).toBe(63.3);
    expect(classifyJitterTier(jitter).tier).toBe('poor');
  });

  it('classifies <15ms as excellent, 15-45ms as fair, and >45ms as poor', () => {
    expect(summarizePingTelemetry([12, 16, 14, 18]).tier).toBe('excellent');
    expect(summarizePingTelemetry([20, 42, 18, 45]).tier).toBe('fair');
  });

  it('renders stability badge and toggles informative tooltip on VenueWifiStats', () => {
    render(
      <VenueWifiStats
        downloadMbps={220}
        uploadMbps={180}
        ssid="WorkSphere_5G"
        pingSamplesMs={[14, 16, 15, 17, 15]}
      />
    );

    expect(screen.getByTestId('wifi-stability-badge').textContent).toBe(
      'Excellent for Video Calls'
    );
    expect(screen.queryByTestId('jitter-tooltip-popover')).toBeNull();

    fireEvent.click(screen.getByTestId('jitter-tooltip-trigger'));
    expect(screen.getByTestId('jitter-tooltip-popover')).toBeTruthy();
  });
});
