import React from 'react';
import { render, screen } from '@testing-library/react';
import {
  aggregateVenueTelemetry,
  exportTelemetrySnapshotJson,
} from '@/lib/telemetry/venueTelemetryEngine';
import { VenueTelemetryCard } from '@/components/telemetry/VenueTelemetryCard';

describe('Multi-Venue Telemetry Aggregator & Anomaly Engine', () => {
  it('handles empty or malformed samples safely without NaN or Infinity', () => {
    const empty = aggregateVenueTelemetry([]);
    expect(empty.sampleCount).toBe(0);
    expect(Number.isNaN(empty.avgDownloadMbps)).toBe(false);

    render(<VenueTelemetryCard venueName="New Cafe" samples={[]} />);
    expect(screen.getByTestId('telemetry-empty-state').textContent).toBe(
      'No telemetry samples recorded yet'
    );
  });

  it('aggregates metrics, detects anomalies, and exports valid JSON snapshot', () => {
    const samples = [
      { downloadMbps: 150, uploadMbps: 90, latencyMs: 18, noiseDb: 58, powerKw: 4 },
      { downloadMbps: 140, uploadMbps: 85, latencyMs: 22, noiseDb: 60, powerKw: 5 },
      { downloadMbps: 145, uploadMbps: 88, latencyMs: 260, noiseDb: 88, powerKw: 18 },
    ];

    const stats = aggregateVenueTelemetry(samples, 20);
    expect(stats.sampleCount).toBe(3);
    expect(stats.acousticRating).toBe('Loud / Noisy');
    expect(stats.anomalies.length).toBeGreaterThanOrEqual(2);

    const json = exportTelemetrySnapshotJson('venue-mumbai-1', stats);
    const parsed = JSON.parse(json);
    expect(parsed.venueId).toBe('venue-mumbai-1');
    expect(parsed.telemetry.sampleCount).toBe(3);
  });
});
