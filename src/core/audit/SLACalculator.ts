/**
 * SLACalculator.ts
 * Evaluates historical venue telemetry data against defined Service Level Agreement (SLA) thresholds.
 */

export interface SLAThresholds {
    minWifiUptimePercent: number;      // e.g., 95
    minAverageWifiSpeedMbps: number;   // e.g., 40
    maxNoiseLevelDb: number;           // e.g., 65
    minSeatAvailabilityPercent: number;// e.g., 20
}

export interface SLAViolation {
    metric: string;
    expected: string;
    actual: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface SLAResult {
    venueId: string;
    isCompliant: boolean;
    complianceScore: number; // 0 to 100
    violations: SLAViolation[];
}

export class SLACalculator {
    private thresholds: SLAThresholds;

    constructor(thresholds: SLAThresholds) {
        this.thresholds = thresholds;
    }

    public evaluate(
        venueId: string,
        wifiUptimePercent: number,
        avgWifiSpeedMbps: number,
        avgNoiseLevelDb: number,
        seatAvailabilityPercent: number
    ): SLAResult {
        const violations: SLAViolation[] = [];
        let score = 100;

        // Check WiFi Uptime
        if (wifiUptimePercent < this.thresholds.minWifiUptimePercent) {
            violations.push({
                metric: 'WiFi Uptime',
                expected: `>= ${this.thresholds.minWifiUptimePercent}%`,
                actual: `${wifiUptimePercent}%`,
                severity: 'HIGH'
            });
            score -= 30;
        }

        // Check WiFi Speed
        if (avgWifiSpeedMbps < this.thresholds.minAverageWifiSpeedMbps) {
            violations.push({
                metric: 'Average WiFi Speed',
                expected: `>= ${this.thresholds.minAverageWifiSpeedMbps} Mbps`,
                actual: `${avgWifiSpeedMbps} Mbps`,
                severity: 'MEDIUM'
            });
            score -= 20;
        }

        // Check Noise Level
        if (avgNoiseLevelDb > this.thresholds.maxNoiseLevelDb) {
            violations.push({
                metric: 'Noise Level',
                expected: `<= ${this.thresholds.maxNoiseLevelDb} dB`,
                actual: `${avgNoiseLevelDb} dB`,
                severity: 'MEDIUM'
            });
            score -= 15;
        }

        // Check Seat Availability
        if (seatAvailabilityPercent < this.thresholds.minSeatAvailabilityPercent) {
            violations.push({
                metric: 'Seat Availability',
                expected: `>= ${this.thresholds.minSeatAvailabilityPercent}%`,
                actual: `${seatAvailabilityPercent}%`,
                severity: 'LOW'
            });
            score -= 10;
        }

        return {
            venueId,
            isCompliant: violations.length === 0,
            complianceScore: Math.max(0, score),
            violations
        };
    }
}
