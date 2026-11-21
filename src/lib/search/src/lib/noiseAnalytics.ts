export type TimeOfDayBucket = 'MORNING' | 'AFTERNOON' | 'EVENING' | 'NIGHT';

export interface DailyNoiseReading {
  date: string;
  decibels: number;
  operatingHours?: number;
  hour?: number;
  timestamp?: string;
}

export interface RollingNoiseMetrics {
  windowDays: number;
  activeDays: number;
  sampleCount: number;
  coverageRatio: number;
  totalDecibels: number;
  windowAverageDb: number;
  activeSampleAverageDb: number;
  operatingHoursWeightedDb: number | null;
}

export interface QuietHourSummary {
  startHour: number;
  endHour: number;
  thresholdDb: number;
  sampleCount: number;
  averageDb: number | null;
  isQuietWindowAvailable: boolean;
}

export interface EnhancedNoiseAnalytics extends RollingNoiseMetrics {
  p50Db: number;
  p90Db: number;
  quietHours: QuietHourSummary;
  timeOfDayBuckets: Record<
    TimeOfDayBucket,
    { sampleCount: number; averageDb: number | null }
  >;
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

export function extractReadingHour(reading: DailyNoiseReading): number | null {
  if (typeof reading.hour === 'number' && Number.isFinite(reading.hour)) {
    const h = Math.floor(reading.hour);
    if (h >= 0 && h <= 23) return h;
  }

  if (reading.timestamp) {
    const hhmmMatch = /^(\d{1,2}):(\d{2})/.exec(reading.timestamp.trim());
    if (hhmmMatch) {
      const h = Number(hhmmMatch[1]);
      if (h >= 0 && h <= 23) return h;
    }
    const parsed = new Date(reading.timestamp);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.getUTCHours();
    }
  }

  return null;
}

export function classifyTimeOfDay(hour: number): TimeOfDayBucket {
  if (hour >= 6 && hour <= 11) return 'MORNING';
  if (hour >= 12 && hour <= 16) return 'AFTERNOON';
  if (hour >= 17 && hour <= 21) return 'EVENING';
  return 'NIGHT';
}

export function computePercentile(values: number[], percentile: number): number {
  const valid = values
    .filter((v) => typeof v === 'number' && Number.isFinite(v))
    .sort((a, b) => a - b);

  if (valid.length === 0) return 0;
  if (valid.length === 1) return roundToTwo(valid[0]);

  const clampedP = Math.min(100, Math.max(0, percentile));
  const rank = (clampedP / 100) * (valid.length - 1);
  const lowerIdx = Math.floor(rank);
  const upperIdx = Math.min(valid.length - 1, Math.ceil(rank));
  const weight = rank - lowerIdx;

  const interpolated = valid[lowerIdx] + (valid[upperIdx] - valid[lowerIdx]) * weight;
  return roundToTwo(interpolated);
}

export function computeQuietHourStats(
  readings: DailyNoiseReading[],
  options: { startHour?: number; endHour?: number; thresholdDb?: number } = {}
): QuietHourSummary {
  const startHour = options.startHour ?? 6;
  const endHour = options.endHour ?? 12;
  const thresholdDb = options.thresholdDb ?? 50;

  const matchingDb: number[] = [];

  for (const reading of readings) {
    if (!Number.isFinite(reading.decibels)) continue;
    const hour = extractReadingHour(reading);
    if (hour === null) continue;

    const inWindow =
      startHour <= endHour
        ? hour >= startHour && hour < endHour
        : hour >= startHour || hour < endHour;

    if (inWindow) {
      matchingDb.push(reading.decibels);
    }
  }

  if (matchingDb.length === 0) {
    return {
      startHour,
      endHour,
      thresholdDb,
      sampleCount: 0,
      averageDb: null,
      isQuietWindowAvailable: false,
    };
  }

  const avg = roundToTwo(
    matchingDb.reduce((acc, v) => acc + v, 0) / matchingDb.length
  );

  return {
    startHour,
    endHour,
    thresholdDb,
    sampleCount: matchingDb.length,
    averageDb: avg,
    isQuietWindowAvailable: avg <= thresholdDb,
  };
}

export function computeRollingNoiseMetrics(
  readings: DailyNoiseReading[],
  windowDays = 7
): RollingNoiseMetrics {
  const safeWindowDays = Math.max(1, Math.floor(windowDays));
  const byDay = new Map<string, { sumDb: number; count: number; hours: number }>();

  for (const reading of readings) {
    if (!Number.isFinite(reading.decibels)) continue;
    const current = byDay.get(reading.date) ?? { sumDb: 0, count: 0, hours: 0 };
    const hours =
      typeof reading.operatingHours === 'number' && reading.operatingHours > 0
        ? reading.operatingHours
        : 1;
    current.sumDb += reading.decibels;
    current.count += 1;
    current.hours += hours;
    byDay.set(reading.date, current);
  }

  let totalDecibels = 0;
  let sampleCount = 0;
  let weightedSum = 0;
  let totalHours = 0;
  let hasExplicitHours = false;

  for (const reading of readings) {
    if (!Number.isFinite(reading.decibels)) continue;
    totalDecibels += reading.decibels;
    sampleCount += 1;
    if (typeof reading.operatingHours === 'number' && reading.operatingHours > 0) {
      hasExplicitHours = true;
      weightedSum += reading.decibels * reading.operatingHours;
      totalHours += reading.operatingHours;
    }
  }

  const activeDays = byDay.size;
  const coverageRatio = roundToTwo(activeDays / safeWindowDays);
  const windowAverageDb = roundToTwo(totalDecibels / safeWindowDays);
  const activeSampleAverageDb =
    activeDays > 0 ? roundToTwo(totalDecibels / activeDays) : 0;
  const operatingHoursWeightedDb =
    hasExplicitHours && totalHours > 0 ? roundToTwo(weightedSum / totalHours) : null;

  return {
    windowDays: safeWindowDays,
    activeDays,
    sampleCount,
    coverageRatio,
    totalDecibels: roundToTwo(totalDecibels),
    windowAverageDb,
    activeSampleAverageDb,
    operatingHoursWeightedDb,
  };
}

export function computeEnhancedNoiseAnalytics(
  readings: DailyNoiseReading[],
  windowDays = 7,
  quietOptions: { startHour?: number; endHour?: number; thresholdDb?: number } = {}
): EnhancedNoiseAnalytics {
  const base = computeRollingNoiseMetrics(readings, windowDays);
  const dbValues = readings
    .map((r) => r.decibels)
    .filter((d) => typeof d === 'number' && Number.isFinite(d));

  const p50Db = computePercentile(dbValues, 50);
  const p90Db = computePercentile(dbValues, 90);
  const quietHours = computeQuietHourStats(readings, quietOptions);

  const bucketSums: Record<TimeOfDayBucket, { sum: number; count: number }> = {
    MORNING: { sum: 0, count: 0 },
    AFTERNOON: { sum: 0, count: 0 },
    EVENING: { sum: 0, count: 0 },
    NIGHT: { sum: 0, count: 0 },
  };

  for (const reading of readings) {
    if (!Number.isFinite(reading.decibels)) continue;
    const hour = extractReadingHour(reading);
    if (hour === null) continue;
    const bucket = classifyTimeOfDay(hour);
    bucketSums[bucket].sum += reading.decibels;
    bucketSums[bucket].count += 1;
  }

  const timeOfDayBuckets: EnhancedNoiseAnalytics['timeOfDayBuckets'] = {
    MORNING: {
      sampleCount: bucketSums.MORNING.count,
      averageDb:
        bucketSums.MORNING.count > 0
          ? roundToTwo(bucketSums.MORNING.sum / bucketSums.MORNING.count)
          : null,
    },
    AFTERNOON: {
      sampleCount: bucketSums.AFTERNOON.count,
      averageDb:
        bucketSums.AFTERNOON.count > 0
          ? roundToTwo(bucketSums.AFTERNOON.sum / bucketSums.AFTERNOON.count)
          : null,
    },
    EVENING: {
      sampleCount: bucketSums.EVENING.count,
      averageDb:
        bucketSums.EVENING.count > 0
          ? roundToTwo(bucketSums.EVENING.sum / bucketSums.EVENING.count)
          : null,
    },
    NIGHT: {
      sampleCount: bucketSums.NIGHT.count,
      averageDb:
        bucketSums.NIGHT.count > 0
          ? roundToTwo(bucketSums.NIGHT.sum / bucketSums.NIGHT.count)
          : null,
    },
  };

  return {
    ...base,
    p50Db,
    p90Db,
    quietHours,
    timeOfDayBuckets,
  };
}