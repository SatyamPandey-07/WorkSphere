export interface WifiSpeedSample {
  downloadMbps: number;
  uploadMbps?: number;
  latencyMs?: number;
  timestamp?: string | number;
}

export interface AggregatedWifiStats {
  avgDownload: number;
  avgUpload: number;
  count: number;
}

function roundOneDecimal(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10) / 10;
}

export function aggregateWifiStats(
  samples?: readonly WifiSpeedSample[] | null
): AggregatedWifiStats {
  if (!samples || samples.length === 0) {
    return { avgDownload: 0, avgUpload: 0, count: 0 };
  }

  let downloadSum = 0;
  let downloadCount = 0;
  let uploadSum = 0;
  let uploadCount = 0;

  for (const sample of samples) {
    if (!sample) continue;

    if (
      typeof sample.downloadMbps === 'number' &&
      Number.isFinite(sample.downloadMbps) &&
      sample.downloadMbps >= 0
    ) {
      downloadSum += sample.downloadMbps;
      downloadCount += 1;
    }

    if (
      typeof sample.uploadMbps === 'number' &&
      Number.isFinite(sample.uploadMbps) &&
      sample.uploadMbps >= 0
    ) {
      uploadSum += sample.uploadMbps;
      uploadCount += 1;
    }
  }

  if (downloadCount === 0 && uploadCount === 0) {
    return { avgDownload: 0, avgUpload: 0, count: 0 };
  }

  const avgDownload =
    downloadCount > 0 ? roundOneDecimal(downloadSum / downloadCount) : 0;
  const avgUpload =
    uploadCount > 0 ? roundOneDecimal(uploadSum / uploadCount) : 0;

  return {
    avgDownload,
    avgUpload,
    count: Math.max(downloadCount, uploadCount),
  };
}

export function formatWifiSpeedSummary(stats: AggregatedWifiStats): string {
  if (!stats || stats.count <= 0) {
    return 'No speed tests recorded yet';
  }

  return `↓ ${stats.avgDownload.toFixed(1)} Mbps · ↑ ${stats.avgUpload.toFixed(1)} Mbps`;
}
