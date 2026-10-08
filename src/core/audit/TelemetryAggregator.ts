/**
 * TelemetryAggregator.ts
 * Time-buckets incoming sensor and user-reported data to establish reliable long-term baselines for auditing.
 */

export interface TelemetryPoint {
    timestamp: number;
    wifiSpeedMbps: number;
    wifiConnected: boolean;
    noiseLevelDb: number;
    seatsAvailable: number;
    totalSeats: number;
}

export interface AggregatedMetrics {
    venueId: string;
    periodStart: number;
    periodEnd: number;
    avgWifiSpeedMbps: number;
    wifiUptimePercent: number;
    avgNoiseLevelDb: number;
    avgSeatAvailabilityPercent: number;
    sampleCount: number;
}

export class TelemetryAggregator {
    /**
     * Aggregates raw telemetry points into a single summary metric object for a given period.
     */
    public aggregate(venueId: string, points: TelemetryPoint[]): AggregatedMetrics {
        if (points.length === 0) {
            throw new Error('Cannot aggregate empty telemetry data');
        }

        let totalSpeed = 0;
        let connectedCount = 0;
        let totalNoise = 0;
        let totalAvailabilityPercent = 0;

        let minTime = points[0].timestamp;
        let maxTime = points[0].timestamp;

        for (const point of points) {
            totalSpeed += point.wifiSpeedMbps;
            if (point.wifiConnected) connectedCount++;
            totalNoise += point.noiseLevelDb;

            const availability = point.totalSeats > 0 ? (point.seatsAvailable / point.totalSeats) * 100 : 0;
            totalAvailabilityPercent += availability;

            if (point.timestamp < minTime) minTime = point.timestamp;
            if (point.timestamp > maxTime) maxTime = point.timestamp;
        }

        const count = points.length;

        return {
            venueId,
            periodStart: minTime,
            periodEnd: maxTime,
            avgWifiSpeedMbps: totalSpeed / count,
            wifiUptimePercent: (connectedCount / count) * 100,
            avgNoiseLevelDb: totalNoise / count,
            avgSeatAvailabilityPercent: totalAvailabilityPercent / count,
            sampleCount: count
        };
    }
}
