import {
  aggregateWifiStats,
  formatWifiSpeedSummary,
} from '@/lib/wifi/aggregateStats';

describe('aggregateWifiStats', () => {
  it('returns safe zero defaults for empty or missing sample arrays', () => {
    expect(aggregateWifiStats([])).toEqual({
      avgDownload: 0,
      avgUpload: 0,
      count: 0,
    });
    expect(aggregateWifiStats(undefined)).toEqual({
      avgDownload: 0,
      avgUpload: 0,
      count: 0,
    });
    expect(formatWifiSpeedSummary(aggregateWifiStats([]))).toBe(
      'No speed tests recorded yet'
    );
  });

  it('computes rounded download and upload averages across valid samples', () => {
    const result = aggregateWifiStats([
      { downloadMbps: 120.4, uploadMbps: 80.2 },
      { downloadMbps: 145.7, uploadMbps: 95.5 },
    ]);

    expect(result).toEqual({
      avgDownload: 133.1,
      avgUpload: 87.9,
      count: 2,
    });
    expect(formatWifiSpeedSummary(result)).toBe('↓ 133.1 Mbps · ↑ 87.9 Mbps');
  });

  it('ignores non-finite or negative outlier entries without producing NaN', () => {
    const result = aggregateWifiStats([
      { downloadMbps: Number.NaN, uploadMbps: -10 },
      { downloadMbps: 200, uploadMbps: 150 },
    ]);

    expect(result).toEqual({
      avgDownload: 200,
      avgUpload: 150,
      count: 1,
    });
    expect(Number.isNaN(result.avgDownload)).toBe(false);
    expect(Number.isNaN(result.avgUpload)).toBe(false);
  });
});
