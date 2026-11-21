export interface DailyNoiseReading {
  date: string;
  decibels: number;
  operatingHours?: number;
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

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
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