/**
 * carbonCalcWorker.ts
 * Web Worker that processes continuous GPS telemetry during the commute to refine the carbon calculation in real-time.
 */

import { CarbonFootprintEngine, TransportMode, RouteSegment } from '../core/sustainability/CarbonFootprintEngine';
import { TrafficCongestionMultiplier, TrafficCondition } from '../core/sustainability/TrafficCongestionMultiplier';

export interface TelemetryMessage {
    type: 'start-tracking' | 'update-location' | 'stop-tracking' | 'set-mode';
    payload?: any;
}

export interface TelemetryEvent {
    type: 'commute-update' | 'commute-complete' | 'error';
    payload?: any;
}

interface GPSPoint {
    lat: number;
    lng: number;
    altitude: number;
    timestamp: number;
    speed: number; // m/s
}

class CarbonTracker {
    private engine: CarbonFootprintEngine = new CarbonFootprintEngine();
    private traffic: TrafficCongestionMultiplier = new TrafficCongestionMultiplier();

    private points: GPSPoint[] = [];
    private mode: TransportMode = TransportMode.CAR_GASOLINE;
    private isTracking: boolean = false;
    private lastCalcTime: number = 0;

    public setMode(mode: TransportMode) {
        this.mode = mode;
    }

    public startTracking() {
        this.isTracking = true;
        this.points = [];
        this.lastCalcTime = Date.now();
        this.postEvent({ type: 'commute-update', payload: { status: 'started' } });
    }

    public stopTracking() {
        this.isTracking = false;
        const result = this.calculateFinalResult();
        this.postEvent({ type: 'commute-complete', payload: result });
    }

    public addPoint(point: GPSPoint) {
        if (!this.isTracking) return;
        this.points.push(point);

        // Calculate and emit update every 10 seconds
        if (Date.now() - this.lastCalcTime > 10000) {
            const result = this.calculateFinalResult();
            this.postEvent({ type: 'commute-update', payload: result });
            this.lastCalcTime = Date.now();
        }
    }

    private calculateFinalResult() {
        if (this.points.length < 2) {
            return { totalDistanceKm: 0, totalCO2Grams: 0, mode: this.mode };
        }

        // Convert GPS points into RouteSegments
        const segments: RouteSegment[] = [];
        let totalDistance = 0;
        let totalDuration = 0;

        for (let i = 1; i < this.points.length; i++) {
            const p1 = this.points[i - 1];
            const p2 = this.points[i];

            // Haversine distance
            const dist = this.haversine(p1.lat, p1.lng, p2.lat, p2.lng);
            const elevGain = Math.max(0, p2.altitude - p1.altitude);
            const duration = (p2.timestamp - p1.timestamp) / 1000;
            const speedKmh = (p2.speed || (dist / duration)) * 3.6;

            segments.push({
                distanceMeters: dist,
                elevationGainMeters: elevGain,
                durationSeconds: duration,
                averageSpeedKmh: speedKmh,
            });

            totalDistance += dist;
            totalDuration += duration;
        }

        const baseResult = this.engine.calculateEmissions(segments, this.mode);

        // Mock traffic conditions for the single aggregated segment
        const mockTraffic: TrafficCondition[] = [{
            segmentIndex: 0,
            congestionLevel: 'moderate',
            idleTimeSeconds: totalDuration * 0.1, // Assume 10% idle time
            averageSpeedKmh: (totalDistance / totalDuration) * 3.6,
        }];

        const adjustments = this.traffic.calculateCongestionPenalty(
            [{ distanceMeters: totalDistance, durationSeconds: totalDuration }],
            mockTraffic,
            this.mode === TransportMode.CAR_ELECTRIC ? 'electric' : 'gasoline'
        );

        const extraCO2 = adjustments.reduce((sum, a) => sum + a.additionalCO2Grams, 0);

        return {
            ...baseResult,
            totalCO2Grams: parseFloat((baseResult.totalCO2Grams + extraCO2).toFixed(2)),
            trafficAdjustments: adjustments,
        };
    }

    private haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const R = 6371e3; // metres
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;

        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c;
    }

    private postEvent(event: TelemetryEvent) {
        self.postMessage(event);
    }
}

const tracker = new CarbonTracker();

self.onmessage = (event: MessageEvent<TelemetryMessage>) => {
    const { type, payload } = event.data;

    if (type === 'start-tracking') {
        tracker.startTracking();
    } else if (type === 'stop-tracking') {
        tracker.stopTracking();
    } else if (type === 'update-location') {
        tracker.addPoint(payload as GPSPoint);
    } else if (type === 'set-mode') {
        tracker.setMode(payload.mode);
    }
};

self.postMessage({ type: 'worker-ready' });
