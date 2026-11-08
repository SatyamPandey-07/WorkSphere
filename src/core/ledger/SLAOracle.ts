/**
 * SLAOracle.ts
 * Continuously polls venue telemetry (WiFi speed, noise levels) and flags SLA breaches during an active booking.
 * Acts as the decentralized oracle for the escrow state machine.
 */

export interface VenueTelemetry {
    venueId: string;
    wifiSpeedMbps: number;
    noiseLevelDb: number;
    timestamp: number;
}

export interface SLAThresholds {
    minWifiSpeedMbps: number;
    maxNoiseLevelDb: number;
}

export class SLAOracle {
    private thresholds: SLAThresholds;
    private activeBookings: Map<string, VenueTelemetry[]>;

    constructor(thresholds: SLAThresholds) {
        this.thresholds = thresholds;
        this.activeBookings = new Map();
    }

    public registerBooking(bookingId: string): void {
        this.activeBookings.set(bookingId, []);
    }

    public ingestTelemetry(bookingId: string, telemetry: VenueTelemetry): void {
        const history = this.activeBookings.get(bookingId);
        if (history) {
            history.push(telemetry);
            this.evaluateSLA(bookingId, telemetry);
        }
    }

    private evaluateSLA(bookingId: string, telemetry: VenueTelemetry): void {
        let isBreached = false;
        const breachReasons: string[] = [];

        if (telemetry.wifiSpeedMbps < this.thresholds.minWifiSpeedMbps) {
            isBreached = true;
            breachReasons.push(`WiFi speed (${telemetry.wifiSpeedMbps} Mbps) below minimum (${this.thresholds.minWifiSpeedMbps} Mbps)`);
        }

        if (telemetry.noiseLevelDb > this.thresholds.maxNoiseLevelDb) {
            isBreached = true;
            breachReasons.push(`Noise level (${telemetry.noiseLevelDb} dB) above maximum (${this.thresholds.maxNoiseLevelDb} dB)`);
        }

        if (isBreached) {
            console.warn(`SLA Breach detected for booking ${bookingId}: ${breachReasons.join(', ')}`);
            // In production, this would emit an event to the EscrowStateMachine
            // escrowMachine.flagSLABreach();
        }
    }

    public getBookingHistory(bookingId: string): VenueTelemetry[] {
        return this.activeBookings.get(bookingId) || [];
    }
}
