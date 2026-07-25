import { mean, standardDeviation } from "./statistics";

export interface RawNoiseData {
  avgDecibels: number;
  timestamp: Date;
}

export interface HourlyForecast {
  hour: number;
  predictedDb: number | null;
  confidence: number;
  samples: number;
}

export interface NoiseForecastResult {
  forecast: HourlyForecast[];
  recommendedHours: number[];
}

export function generateNoiseForecast(
  data: RawNoiseData[],
): NoiseForecastResult {
  // 1. Group historical readings by hour of day (0-23)
  const groupedByHour: Record<number, number[]> = {};
  for (let i = 0; i < 24; i++) {
    groupedByHour[i] = [];
  }

  for (const entry of data) {
    const hour = entry.timestamp.getHours();
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
        confidence: 0,
        samples: 0,
      });
      continue;
    }

    const avg = mean(samples);
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
      confidence: Math.round(confidence * 100) / 100, // 2 decimal places
      samples: n,
    });
  }

  // 4. Identify Quietest Hours (top 3)
  // Only consider hours with actual data
  const validForecasts = forecast.filter((f) => f.predictedDb !== null);
  validForecasts.sort((a, b) => a.predictedDb! - b.predictedDb!);

  const recommendedHours = validForecasts.slice(0, 3).map((f) => f.hour);

  return {
    forecast,
    recommendedHours,
  };
}
