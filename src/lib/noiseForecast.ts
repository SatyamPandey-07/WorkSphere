import { mean, standardDeviation, median } from "./statistics";
import { isValidTimeZone } from "./booking/dateTimeAdapter";

export interface RawNoiseData {
  avgDecibels: number;
  timestamp: Date | string | number;
}

export interface HourlyForecast {
  hour: number;
  predictedDb: number | null;
  medianDb?: number | null;
  confidence: number;
  samples: number;
}

export interface NoiseForecastResult {
  forecast: HourlyForecast[];
  recommendedHours: number[];
}

/**
 * @param timeZone IANA zone to bucket readings in (the viewer's zone). Without
 * one, getHours() uses the server's zone, which is UTC in production, so every
 * hour on the chart would be shifted by the viewer's UTC offset.
 */
export function generateNoiseForecast(
  data: RawNoiseData[],
  timeZone?: string,
): NoiseForecastResult {
  if (!data || !Array.isArray(data)) {
    return { forecast: [], recommendedHours: [] };
  }
  // 1. Group historical readings by hour of day (0-23)
  const groupedByHour: Record<number, number[]> = {};
  for (let i = 0; i < 24; i++) {
    groupedByHour[i] = [];
  }

  const hourFormatter =
    timeZone && isValidTimeZone(timeZone)
      ? new Intl.DateTimeFormat("en-US", {
          timeZone,
          hour: "numeric",
          hourCycle: "h23",
        })
      : null;

  for (const entry of data) {
    if (!entry) continue;

    // Validate decibels: must be a finite, non-negative number
    if (
      typeof entry.avgDecibels !== "number" ||
      !Number.isFinite(entry.avgDecibels) ||
      entry.avgDecibels < 0
    ) {
      continue;
    }

    // Coerce timestamp if Date, ISO string, or timestamp number
    const ts =
      entry.timestamp instanceof Date
        ? entry.timestamp
        : new Date(entry.timestamp);

    if (!ts || isNaN(ts.getTime())) continue;

    const hour = hourFormatter
      ? Number(
          hourFormatter
            .formatToParts(ts)
            .find((part) => part.type === "hour")?.value,
        ) % 24
      : ts.getHours();

    groupedByHour[hour].push(entry.avgDecibels);
  }

  const forecast: HourlyForecast[] = [];

  // 2. Process each hour
  for (let i = 0; i < 24; i++) {
    const samples = groupedByHour[i];
    const n = samples.length;

    if (n === 0) {
      forecast.push({
        hour: i,
        predictedDb: null,
        medianDb: null,
        confidence: 0,
        samples: 0,
      });
      continue;
    }

    const avg = mean(samples);
    const med = median(samples);
    const stdDev = standardDeviation(samples);

    // 3. Confidence Algorithm
    // - Based on number of samples (up to 10 gives max size confidence)
    const sizeConfidence = Math.min(n / 10, 1);
    // - Based on variance (if stdDev is > 15dB, confidence drops significantly)
    // - If n == 1, stdDev is 0, but we shouldn't be fully confident with 1 sample.
    const varianceConfidence = n > 1 ? Math.max(1 - stdDev / 15, 0) : 0.5;

    // Combine: sample size matters more (70%) than variance (30%)
    let confidence = sizeConfidence * 0.7 + varianceConfidence * 0.3;

    // Cap confidence
    confidence = Math.min(Math.max(confidence, 0.1), 0.99);

    forecast.push({
      hour: i,
      predictedDb: Math.round(avg * 10) / 10,
      medianDb: Math.round(med * 10) / 10,
      confidence: Math.round(confidence * 100) / 100, // 2 decimal places
      samples: n,
    });
  }

  // 4. Identify Quietest Hours (top 3)
  // Only consider hours with actual data
  const validForecasts = forecast.filter((f) => f.predictedDb !== null);
  validForecasts.sort((a, b) => {
    if (a.predictedDb! !== b.predictedDb!) {
      return a.predictedDb! - b.predictedDb!;
    }
    if (a.confidence !== b.confidence) {
      return b.confidence - a.confidence;
    }
    return a.hour - b.hour;
  });

  const recommendedHours = validForecasts.slice(0, 3).map((f) => f.hour);

  return {
    forecast,
    recommendedHours,
  };
}
