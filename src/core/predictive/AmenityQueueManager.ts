/**
 * AmenityQueueManager.ts
 * Aggregates edge-device reports to calculate real-time wait times and predict queue dissipation.
 * Uses exponential moving average to smooth out transient spikes in crowd detection.
 */

export interface ZoneReport {
    zoneId: string;
    venueId: string;
    estimatedCount: number;
    confidence: number;
    timestamp: number;
}

export interface QueuePrediction {
    zoneId: string;
    currentWaitTimeMinutes: number;
    predictedWaitTimeMinutes: number;
    congestionLevel: 'LOW' | 'MODERATE' | 'HIGH';
    trend: 'INCREASING' | 'STABLE' | 'DECREASING';
}

export class AmenityQueueManager {
    private zoneHistory: Map<string, ZoneReport[]>;
    private averageProcessingTimePerPerson: number; // in minutes

    constructor(averageProcessingTimePerPerson: number = 2.5) {
        this.zoneHistory = new Map();
        this.averageProcessingTimePerPerson = averageProcessingTimePerPerson;
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
        const previousCount = history.length > 1 ? history[history.length - 2].estimatedCount : currentCount;

        const currentWaitTime = Math.round(ema * this.averageProcessingTimePerPerson);

        // Simple trend prediction: if count is increasing, add 20% to wait time
        let predictedWaitTime = currentWaitTime;
        let trend: QueuePrediction['trend'] = 'STABLE';

        if (currentCount > previousCount + 1) {
            predictedWaitTime = Math.round(currentWaitTime * 1.2);
            trend = 'INCREASING';
        } else if (currentCount < previousCount - 1) {
            predictedWaitTime = Math.round(currentWaitTime * 0.8);
            trend = 'DECREASING';
        }

        let congestionLevel: QueuePrediction['congestionLevel'] = 'LOW';
        if (ema > 5) congestionLevel = 'HIGH';
        else if (ema > 2) congestionLevel = 'MODERATE';

        return {
            zoneId,
            currentWaitTimeMinutes: currentWaitTime,
            predictedWaitTimeMinutes: predictedWaitTime,
            congestionLevel,
            trend
        };
    }

    public getAllPredictions(venueId: string): QueuePrediction[] {
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
