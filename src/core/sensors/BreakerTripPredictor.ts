/**
 * @file BreakerTripPredictor.ts
 * @description Evaluates real-time IoT current-sensor data against the venue's 
 * physical circuit-breaker thresholds to calculate a "Trip Probability" score.
 * Alerts users to switch to low-power modes when an imminent trip is detected.
 */

export interface CircuitProfile {
    id: string;
    maxAmperage: number;
    voltage: number;
    maxWattage: number;
    tripCurveType: 'standard' | 'slow-blow' | 'fast-acting';
}

export interface SensorReading {
    circuitId: string;
    timestamp: number;
    amperage: number;
    wattage: number;
}

export interface TripRiskAssessment {
    circuitId: string;
    currentLoadPercent: number;
    tripProbability: number; // 0.0 to 1.0
    estimatedTimeToTripMs: number | null;
    severity: 'safe' | 'warning' | 'critical';
}

export class BreakerTripPredictor {
    private circuits: Map<string, CircuitProfile>;
    private readingHistory: Map<string, SensorReading[]>;
    private readonly HISTORY_WINDOW = 60; // Keep last 60 readings per circuit

    constructor() {
        this.circuits = new Map();
        this.readingHistory = new Map();
    }

    public registerCircuit(profile: CircuitProfile): void {
        this.circuits.set(profile.id, profile);
        this.readingHistory.set(profile.id, []);
    }

    public ingestReading(reading: SensorReading): TripRiskAssessment | null {
        const circuit = this.circuits.get(reading.circuitId);
        if (!circuit) return null;

        const history = this.readingHistory.get(reading.circuitId)!;
        history.push(reading);
        if (history.length > this.HISTORY_WINDOW) {
            history.shift();
        }

        return this.calculateRisk(circuit, history);
    }

    private calculateRisk(circuit: CircuitProfile, history: SensorReading[]): TripRiskAssessment {
        const latest = history[history.length - 1];
        const loadPercent = (latest.wattage / circuit.maxWattage) * 100;

        let tripProbability = 0;
        let estimatedTimeToTripMs: number | null = null;

        if (loadPercent >= 100) {
            tripProbability = 1.0;
            estimatedTimeToTripMs = this.calculateTimeToTrip(circuit, history);
        } else if (loadPercent >= 90) {
            // High sustained load
            const sustainedCount = history.filter(r => (r.wattage / circuit.maxWattage) >= 0.9).length;
            tripProbability = Math.min(0.9, sustainedCount / history.length);

            if (tripProbability > 0.5) {
                estimatedTimeToTripMs = this.calculateTimeToTrip(circuit, history);
            }
        } else if (loadPercent >= 80) {
            tripProbability = 0.1 + ((loadPercent - 80) / 20) * 0.3;
        }

        // Adjust based on trip curve
        if (circuit.tripCurveType === 'slow-blow' && loadPercent < 120) {
            tripProbability *= 0.5; // Slow blow resist short overloads better
        } else if (circuit.tripCurveType === 'fast-acting' && loadPercent > 95) {
            tripProbability = Math.min(1.0, tripProbability * 1.5);
        }

        let severity: 'safe' | 'warning' | 'critical' = 'safe';
        if (tripProbability >= 0.7) severity = 'critical';
        else if (tripProbability >= 0.4) severity = 'warning';

        return {
            circuitId: circuit.id,
            currentLoadPercent: loadPercent,
            tripProbability,
            estimatedTimeToTripMs,
            severity,
        };
    }

    private calculateTimeToTrip(circuit: CircuitProfile, history: SensorReading[]): number | null {
        if (history.length < 3) return null;

        // Simple linear extrapolation of the last 3 readings
        const r1 = history[history.length - 3];
        const r2 = history[history.length - 2];
        const r3 = history[history.length - 1];

        const dt1 = r2.timestamp - r1.timestamp;
        const dt2 = r3.timestamp - r2.timestamp;
        const avgDt = (dt1 + dt2) / 2;

        const dw1 = r2.wattage - r1.wattage;
        const dw2 = r3.wattage - r2.wattage;
        const avgDw = (dw1 + dw2) / 2;

        if (avgDw <= 0) return null; // Load is stable or dropping

        const wattsToLimit = circuit.maxWattage - r3.wattage;
        if (wattsToLimit <= 0) return 0; // Already over limit

        const stepsToLimit = wattsToLimit / avgDw;
        return Math.max(0, stepsToLimit * avgDt);
    }

    public getCircuitStatus(circuitId: string): TripRiskAssessment | null {
        const circuit = this.circuits.get(circuitId);
        const history = this.readingHistory.get(circuitId);
        if (!circuit || !history || history.length === 0) return null;

        return this.calculateRisk(circuit, history);
    }
}
