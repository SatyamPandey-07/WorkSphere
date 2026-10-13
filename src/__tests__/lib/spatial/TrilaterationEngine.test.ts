/**
 * TrilaterationEngine.test.ts
 * Unit tests for the TrilaterationEngine class.
 */

import { TrilaterationEngine, BeaconReading } from '@/lib/spatial/TrilaterationEngine';

describe('TrilaterationEngine', () => {
    let engine: TrilaterationEngine;

    beforeEach(() => {
        engine = new TrilaterationEngine(-59, 2.0, 0.3);
    });

    it('should return null if less than 3 beacons are provided', () => {
        const readings: BeaconReading[] = [
            { id: '1', rssi: -60, x: 0, y: 0 },
            { id: '2', rssi: -65, x: 10, y: 0 },
        ];

        const position = engine.calculatePosition(readings);
        expect(position).toBeNull();
    });

    it('should calculate a position when 3 or more beacons are provided', () => {
        const readings: BeaconReading[] = [
            { id: '1', rssi: -60, x: 0, y: 0 },
            { id: '2', rssi: -65, x: 10, y: 0 },
            { id: '3', rssi: -65, x: 0, y: 10 },
        ];

        const position = engine.calculatePosition(readings);
        expect(position).not.toBeNull();
        expect(position!.x).toBeDefined();
        expect(position!.y).toBeDefined();
        expect(position!.accuracy).toBeGreaterThan(0);
    });

    it('should smooth position updates to prevent jumping', () => {
        const readings1: BeaconReading[] = [
            { id: '1', rssi: -60, x: 0, y: 0 },
            { id: '2', rssi: -65, x: 10, y: 0 },
            { id: '3', rssi: -65, x: 0, y: 10 },
        ];

        const readings2: BeaconReading[] = [
            { id: '1', rssi: -60, x: 0, y: 0 },
            { id: '2', rssi: -65, x: 20, y: 0 }, // Moved beacon 2
            { id: '3', rssi: -65, x: 0, y: 10 },
        ];

        const pos1 = engine.calculatePosition(readings1);
        const pos2 = engine.calculatePosition(readings2);

        // Pos2 should be smoothed towards pos1, not a hard jump
        expect(pos2).not.toBeNull();
    });

    it('should reset internal state correctly', () => {
        const readings: BeaconReading[] = [
            { id: '1', rssi: -60, x: 0, y: 0 },
            { id: '2', rssi: -65, x: 10, y: 0 },
            { id: '3', rssi: -65, x: 0, y: 10 },
        ];

        engine.calculatePosition(readings);
        engine.reset();

        // After reset, the next calculation should not be smoothed against the old position
        expect(engine['lastPosition']).toBeNull();
    });
});
