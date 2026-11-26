export interface VenueTelemetrySample {
  downloadMbps?: number | null;
  uploadMbps?: number | null;
  latencyMs?: number | null;
  noiseDb?: number | null;
  powerKw?: number | null;
  timestampMs?: number | null;
}

export interface TelemetryAnomaly {
  metric: 'downloadMbps' | 'latencyMs' | 'noiseDb' | 'powerKw';
  value: number;
  threshold: number;
  reason: string;
}

export interface AggregatedVenueTelemetry {
  sampleCount: number;
  avgDownloadMbps: number;
  avgUploadMbps: number;
  avgLatencyMs: number;
  avgNoiseDb: number;
  totalPowerKw: number;
  acousticRating: 'Quiet Focus' | 'Moderate Cafe' | 'Loud / Noisy';
  baselineUsagePercent: number;
  clampedBarPercent: number;
  overagePercent: number;
  anomalies: TelemetryAnomaly[];
}

export interface TelemetrySnapshotPayload {
  venueId: string;
  exportedAt: string;
  telemetry: AggregatedVenueTelemetry;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function round1(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10) / 10;
}

export function classifyAcousticLevel(
  avgNoiseDb: number,
  sampleCount: number
): 'Quiet Focus' | 'Moderate Cafe' | 'Loud / Noisy' {
  if (sampleCount <= 0 || !Number.isFinite(avgNoiseDb) || avgNoiseDb <= 50) {
    return 'Quiet Focus';
  }
  if (avgNoiseDb <= 68) return 'Moderate Cafe';
  return 'Loud / Noisy';
}

export function detectTelemetryAnomalies(
  samples: readonly (VenueTelemetrySample | null | undefined)[]
): TelemetryAnomaly[] {
  const anomalies: TelemetryAnomaly[] = [];

  const validLatency = samples
    .map((s) => s?.latencyMs)
    .filter(isFiniteNonNegative);
  if (validLatency.length >= 2) {
    const avgLat =
      validLatency.reduce((acc, v) => acc + v, 0) / validLatency.length;
    const spikeThreshold = Math.max(120, avgLat * 2);
    for (const lat of validLatency) {
      if (lat > spikeThreshold) {
        anomalies.push({
          metric: 'latencyMs',
          value: round1(lat),
          threshold: round1(spikeThreshold),
          reason: 'Latency spike above rolling average',
        });
      }
    }
  }

  const validNoise = samples
    .map((s) => s?.noiseDb)
    .filter(isFiniteNonNegative);
  for (const db of validNoise) {
    if (db > 82) {
      anomalies.push({
        metric: 'noiseDb',
        value: round1(db),
        threshold: 82,
        reason: 'Elevated ambient noise level',
      });
    }
  }

  const validPower = samples
    .map((s) => s?.powerKw)
    .filter(isFiniteNonNegative);
  if (validPower.length >= 2) {
    const avgPower =
      validPower.reduce((acc, v) => acc + v, 0) / validPower.length;
    const surgeThreshold = avgPower * 1.6;
    for (const kw of validPower) {
      if (kw > surgeThreshold && avgPower > 0) {
        anomalies.push({
          metric: 'powerKw',
          value: round1(kw),
          threshold: round1(surgeThreshold),
          reason: 'Power draw surge above rolling mean',
        });
      }
    }
  }

  return anomalies;
}

export function aggregateVenueTelemetry(
  samples?: readonly (VenueTelemetrySample | null | undefined)[] | null,
  baselineKwh = 1000
): AggregatedVenueTelemetry {
  if (!samples || samples.length === 0) {
    return {
      sampleCount: 0,
      avgDownloadMbps: 0,
      avgUploadMbps: 0,
      avgLatencyMs: 0,
      avgNoiseDb: 0,
      totalPowerKw: 0,
      acousticRating: 'Quiet Focus',
      baselineUsagePercent: 0,
      clampedBarPercent: 0,
      overagePercent: 0,
      anomalies: [],
    };
  }

  let dlSum = 0;
  let dlCount = 0;
  let ulSum = 0;
  let ulCount = 0;
  let latSum = 0;
  let latCount = 0;
  let noiseSum = 0;
  let noiseCount = 0;
  let powerSum = 0;
  let powerCount = 0;

  for (const s of samples) {
    if (!s) continue;
    if (isFiniteNonNegative(s.downloadMbps)) {
      dlSum += s.downloadMbps;
      dlCount += 1;
    }
    if (isFiniteNonNegative(s.uploadMbps)) {
      ulSum += s.uploadMbps;
      ulCount += 1;
    }
    if (isFiniteNonNegative(s.latencyMs)) {
      latSum += s.latencyMs;
      latCount += 1;
    }
    if (isFiniteNonNegative(s.noiseDb)) {
      noiseSum += s.noiseDb;
      noiseCount += 1;
    }
    if (isFiniteNonNegative(s.powerKw)) {
      powerSum += s.powerKw;
      powerCount += 1;
    }
  }

  const sampleCount = Math.max(
    dlCount,
    ulCount,
    latCount,
    noiseCount,
    powerCount
  );

  if (sampleCount === 0) {
    return {
      sampleCount: 0,
      avgDownloadMbps: 0,
      avgUploadMbps: 0,
      avgLatencyMs: 0,
      avgNoiseDb: 0,
      totalPowerKw: 0,
      acousticRating: 'Quiet Focus',
      baselineUsagePercent: 0,
      clampedBarPercent: 0,
      overagePercent: 0,
      anomalies: [],
    };
  }

  const avgDownloadMbps = dlCount > 0 ? round1(dlSum / dlCount) : 0;
  const avgUploadMbps = ulCount > 0 ? round1(ulSum / ulCount) : 0;
  const avgLatencyMs = latCount > 0 ? round1(latSum / latCount) : 0;
  const avgNoiseDb = noiseCount > 0 ? round1(noiseSum / noiseCount) : 0;
  const totalPowerKw = round1(powerSum);

  const safeBaseline =
    typeof baselineKwh === 'number' &&
    Number.isFinite(baselineKwh) &&
    baselineKwh > 0
      ? baselineKwh
      : 1;
  const baselineUsagePercent = round1((totalPowerKw / safeBaseline) * 100);
  const clampedBarPercent = Math.min(100, Math.max(0, baselineUsagePercent));
  const overagePercent = Math.max(0, Math.round(baselineUsagePercent - 100));

  return {
    sampleCount,
    avgDownloadMbps,
    avgUploadMbps,
    avgLatencyMs,
    avgNoiseDb,
    totalPowerKw,
    acousticRating: classifyAcousticLevel(avgNoiseDb, sampleCount),
    baselineUsagePercent,
    clampedBarPercent,
    overagePercent,
    anomalies: detectTelemetryAnomalies(samples),
  };
}

export function exportTelemetrySnapshotJson(
  venueId: string,
  telemetry: AggregatedVenueTelemetry
): string {
  const payload: TelemetrySnapshotPayload = {
    venueId,
    exportedAt: new Date().toISOString(),
    telemetry,
  };
  return JSON.stringify(payload, null, 2);
}
