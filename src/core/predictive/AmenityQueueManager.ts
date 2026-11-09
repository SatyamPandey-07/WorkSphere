/**
 * AmenityQueueManager.ts
 * Aggregates edge-device reports to calculate real-time wait times and predict queue dissipation.
 * Uses exponential moving average (EMA) of historical occupancy turnover durations for specific
 * amenity types (phone booth, standing desk, private meeting room) to calculate reliable wait times
 * and confidence intervals for remote nomads.
 */

export type AmenityType =
  "phone_booth" | "standing_desk" | "private_meeting_room" | string;

export interface ZoneReport {
  zoneId: string;
  venueId: string;
  estimatedCount: number;
  confidence: number;
  timestamp: number;
  amenityType?: AmenityType;
  turnoverDurationMinutes?: number;
}

export interface QueuePrediction {
  zoneId: string;
  currentWaitTimeMinutes: number;
  predictedWaitTimeMinutes: number;
  congestionLevel: "LOW" | "MODERATE" | "HIGH";
  trend: "INCREASING" | "STABLE" | "DECREASING";
  estimatedWaitMinutes?: number;
  minEstimate?: number;
  maxEstimate?: number;
}

export interface WaitTimeEstimate {
  amenityType: AmenityType;
  queuePosition: number;
  averageDurationMinutes: number;
  estimatedWaitMinutes: number;
  minEstimate: number;
  maxEstimate: number;
  confidence: number;
}

export interface AmenityTurnoverStats {
  history: number[];
  emaDurationMinutes: number;
}

/**
 * Normalizes user-facing amenity strings into canonical amenity keys.
 */
export function normalizeAmenityType(type: string): string {
  const cleaned = type
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (cleaned.includes("phone") && cleaned.includes("booth")) {
    return "phone_booth";
  }
  if (cleaned.includes("standing") && cleaned.includes("desk")) {
    return "standing_desk";
  }
  if (cleaned.includes("meeting") || cleaned.includes("conference")) {
    return "private_meeting_room";
  }
  return cleaned;
}

export const DEFAULT_BASELINE_DURATIONS: Record<string, number> = {
  phone_booth: 15, // 15 mins average phone booth session
  standing_desk: 30, // 30 mins standing desk session
  private_meeting_room: 45, // 45 mins private meeting room session
};

export class AmenityQueueManager {
  private zoneHistory: Map<string, ZoneReport[]>;
  private turnoverHistory: Map<string, AmenityTurnoverStats>;
  private averageProcessingTimePerPerson: number; // in minutes
  private readonly rollingWindowSize: number;
  private readonly emaAlpha: number;

  constructor(
    averageProcessingTimePerPerson: number = 2.5,
    rollingWindowSize: number = 20,
    emaAlpha: number = 0.3,
  ) {
    this.zoneHistory = new Map();
    this.turnoverHistory = new Map();
    this.averageProcessingTimePerPerson = averageProcessingTimePerPerson;
    this.rollingWindowSize = rollingWindowSize;
    this.emaAlpha = emaAlpha;
  }

  /**
   * Records a historical turnover/occupancy duration for a specific amenity.
   * Updates the rolling window and recalculates Exponential Moving Average (EMA).
   */
  public recordTurnover(amenity: AmenityType, durationMinutes: number): void {
    if (durationMinutes <= 0 || !isFinite(durationMinutes)) {
      return;
    }

    const key = normalizeAmenityType(amenity);
    let stats = this.turnoverHistory.get(key);

    if (!stats) {
      stats = {
        history: [durationMinutes],
        emaDurationMinutes: durationMinutes,
      };
      this.turnoverHistory.set(key, stats);
      return;
    }

    // Append to rolling window and maintain maximum size
    stats.history.push(durationMinutes);
    if (stats.history.length > this.rollingWindowSize) {
      stats.history.shift();
    }

    // Compute Exponential Moving Average (EMA)
    stats.emaDurationMinutes =
      this.emaAlpha * durationMinutes +
      (1 - this.emaAlpha) * stats.emaDurationMinutes;
  }

  public recordTurnoverDuration(
    amenity: AmenityType,
    durationMinutes: number,
  ): void {
    this.recordTurnover(amenity, durationMinutes);
  }

  /**
   * Retrieves the historical turnover duration rolling window for an amenity.
   */
  public getTurnoverHistory(amenity: AmenityType): number[] {
    const key = normalizeAmenityType(amenity);
    const stats = this.turnoverHistory.get(key);
    return stats ? [...stats.history] : [];
  }

  /**
   * Returns the current EMA average turnover duration in minutes for an amenity.
   */
  public getAverageDurationMinutes(amenity: AmenityType): number {
    const key = normalizeAmenityType(amenity);
    const stats = this.turnoverHistory.get(key);
    if (stats) {
      return Number(stats.emaDurationMinutes.toFixed(2));
    }
    return (
      DEFAULT_BASELINE_DURATIONS[key] ?? this.averageProcessingTimePerPerson
    );
  }

  public getAverageDuration(amenity: AmenityType): number {
    return this.getAverageDurationMinutes(amenity);
  }

  /**
   * Calculates estimated wait time and confidence interval bounds for a given queue position
   * using the Exponential Moving Average of historical turnover durations.
   *
   * Formula: estimatedWaitMinutes = queuePosition * averageDurationMinutes
   */
  public calculateWaitTime(
    amenity: AmenityType,
    queuePosition: number,
    confidenceLevel: number = 0.95,
  ): WaitTimeEstimate {
    const key = normalizeAmenityType(amenity);
    const avgDuration = this.getAverageDurationMinutes(key);

    if (queuePosition <= 0) {
      return {
        amenityType: key,
        queuePosition: Math.max(0, queuePosition),
        averageDurationMinutes: avgDuration,
        estimatedWaitMinutes: 0,
        minEstimate: 0,
        maxEstimate: 0,
        confidence: 1.0,
      };
    }

    const estimatedWaitMinutes = Number(
      (queuePosition * avgDuration).toFixed(1),
    );
    const stats = this.turnoverHistory.get(key);

    let marginOfError = 0;
    let confidence = 0.8;

    if (stats && stats.history.length >= 2) {
      const n = stats.history.length;
      const mean = stats.history.reduce((sum, d) => sum + d, 0) / n;
      const variance =
        stats.history.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) /
        (n - 1);
      const stdDev = Math.sqrt(variance);

      // Variance for sum of k independent turnovers: k * variance -> std error: sqrt(k) * stdDev
      const stdErrorSum = Math.sqrt(queuePosition) * stdDev;
      const z = confidenceLevel >= 0.95 ? 1.96 : 1.645;
      marginOfError = z * stdErrorSum;
      confidence = Math.min(
        0.99,
        Number((0.6 + 0.35 * (n / this.rollingWindowSize)).toFixed(2)),
      );
    } else {
      // Heuristic fallback margin of error when limited history exists
      marginOfError = estimatedWaitMinutes * 0.25;
      confidence = 0.6;
    }

    const minEstimate = Math.max(
      0,
      Number((estimatedWaitMinutes - marginOfError).toFixed(1)),
    );
    const maxEstimate = Number(
      (estimatedWaitMinutes + marginOfError).toFixed(1),
    );

    return {
      amenityType: key,
      queuePosition,
      averageDurationMinutes: avgDuration,
      estimatedWaitMinutes,
      minEstimate,
      maxEstimate,
      confidence,
    };
  }

  public getEstimatedWaitTime(
    amenity: AmenityType,
    queuePosition: number,
    confidenceLevel?: number,
  ): WaitTimeEstimate {
    return this.calculateWaitTime(amenity, queuePosition, confidenceLevel);
  }

  public ingestReport(report: ZoneReport): void {
    if (!this.zoneHistory.has(report.zoneId)) {
      this.zoneHistory.set(report.zoneId, []);
    }

    const history = this.zoneHistory.get(report.zoneId)!;
    history.push(report);

    // Keep only last 10 reports (e.g., last 5 minutes if reporting every 30s)
    if (history.length > 10) {
      history.shift();
    }

    // If report includes turnover duration metrics, record them
    if (
      report.amenityType &&
      typeof report.turnoverDurationMinutes === "number"
    ) {
      this.recordTurnover(report.amenityType, report.turnoverDurationMinutes);
    }
  }

  public getPrediction(zoneId: string): QueuePrediction | null {
    const history = this.zoneHistory.get(zoneId);
    if (!history || history.length === 0) {
      return null;
    }

    // Calculate Exponential Moving Average (EMA) of the count
    const alpha = 0.3;
    let ema = history[0].estimatedCount;
    for (let i = 1; i < history.length; i++) {
      ema = alpha * history[i].estimatedCount + (1 - alpha) * ema;
    }

    const currentCount = history[history.length - 1].estimatedCount;
    const previousCount =
      history.length > 1
        ? history[history.length - 2].estimatedCount
        : currentCount;

    const currentWaitTime = Math.round(
      ema * this.averageProcessingTimePerPerson,
    );

    // Simple trend prediction: if count is increasing, add 20% to wait time
    let predictedWaitTime = currentWaitTime;
    let trend: QueuePrediction["trend"] = "STABLE";

    if (currentCount > previousCount + 1) {
      predictedWaitTime = Math.round(currentWaitTime * 1.2);
      trend = "INCREASING";
    } else if (currentCount < previousCount - 1) {
      predictedWaitTime = Math.round(currentWaitTime * 0.8);
      trend = "DECREASING";
    }

    let congestionLevel: QueuePrediction["congestionLevel"] = "LOW";
    if (ema > 5) congestionLevel = "HIGH";
    else if (ema > 2) congestionLevel = "MODERATE";

    const latestReport = history[history.length - 1];
    let waitEstimate: WaitTimeEstimate | null = null;
    if (latestReport.amenityType) {
      waitEstimate = this.calculateWaitTime(
        latestReport.amenityType,
        Math.round(ema),
      );
    }

    return {
      zoneId,
      currentWaitTimeMinutes: currentWaitTime,
      predictedWaitTimeMinutes: predictedWaitTime,
      congestionLevel,
      trend,
      estimatedWaitMinutes: waitEstimate?.estimatedWaitMinutes,
      minEstimate: waitEstimate?.minEstimate,
      maxEstimate: waitEstimate?.maxEstimate,
    };
  }

  public getAllPredictions(_venueId: string): QueuePrediction[] {
    const predictions: QueuePrediction[] = [];
    for (const [zoneId] of this.zoneHistory.entries()) {
      const pred = this.getPrediction(zoneId);
      if (pred) {
        predictions.push(pred);
      }
    }
    return predictions;
  }
}
