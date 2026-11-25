import React from 'react';
import { render, screen } from '@testing-library/react';
import {
  aggregateVenueTelemetry,
  classifyAcousticLevel,
  exportTelemetrySnapshotJson,
} from '@/lib/telemetry/venueTelemetryEngine';
import { VenueTelemetryCard } from '@/components/telemetry/VenueTelemetryCard';

describe('Multi-Venue Telemetry Aggregator & Anomaly Engine', () => {
  it('handles empty, null, and non-finite samples safely without NaN or Infinity', () => {
    const malformed = [
      null,
      undefined,
      {
        downloadMbps: Number.NaN,
        uploadMbps: Number.POSITIVE_INFINITY,
        latencyMs: -15,
        noiseDb: Number.NaN,
        powerKw: -5,
      },
    ];
    const stats = aggregateVenueTelemetry(malformed);
    expect(stats.sampleCount).toBe(0);
    expect(Number.isNaN(stats.avgDownloadMbps)).toBe(false);
    expect(Number.isFinite(stats.avgUploadMbps)).toBe(true);

    render(<VenueTelemetryCard venueName="New Cafe" samples={malformed} />);
    expect(screen.getByTestId('telemetry-empty-state').textContent).toBe(
      'No telemetry samples recorded yet'
    );
  });

  it('classifies acoustic bands, detects rolling spikes, clamps baseline bar, and exports JSON', () => {
    expect(classifyAcousticLevel(45, 2)).toBe('Quiet Focus');
    expect(classifyAcousticLevel(60, 2)).toBe('Moderate Cafe');
    expect(classifyAcousticLevel(75, 2)).toBe('Loud / Noisy');

    const samples = [
      { downloadMbps: 150, uploadMbps: 90, latencyMs: 18, noiseDb: 58, powerKw: 4 },
      { downloadMbps: 140, uploadMbps: 85, latencyMs: 22, noiseDb: 60, powerKw: 5 },
      { downloadMbps: 145, uploadMbps: 88, latencyMs: 260, noiseDb: 88, powerKw: 18 },
    ];

    const stats = aggregateVenueTelemetry(samples, 20);
    expect(stats.sampleCount).toBe(3);
    expect(stats.acousticRating).toBe('Loud / Noisy');
    expect(stats.clampedBarPercent).toBe(100);
    expect(stats.overagePercent).toBe(35);
    expect(stats.anomalies.length).toBeGreaterThanOrEqual(2);

    const json = exportTelemetrySnapshotJson('venue-mumbai-1', stats);
    const parsed = JSON.parse(json);
    expect(parsed.venueId).toBe('venue-mumbai-1');
    expect(parsed.telemetry.sampleCount).toBe(3);

    render(
      <VenueTelemetryCard
        venueName="Bandra Tech Hub"
        samples={samples}
        baselineKwh={20}
      />
    );
    expect(screen.getByTestId('telemetry-overage-badge').textContent).toBe(
      '+35% above baseline'
    );
    expect(
      (screen.getByTestId('telemetry-baseline-bar') as HTMLElement).style.width
    ).toBe('100%');
  });
});
