/**
 * PredictiveOrientation.test.ts
 * Unit tests for the PredictiveOrientation class to ensure smooth AR tracking.
 */

import { PredictiveOrientation, OrientationData } from '@/lib/ar/PredictiveOrientation';

describe('PredictiveOrientation', () => {
    it('should initialize with identity quaternion', () => {
        const predictor = new PredictiveOrientation();
        const mockData: OrientationData = { alpha: 0, beta: 0, gamma: 0, timestamp: 1000 };
        const result = predictor.update(mockData);

        expect(result).toHaveLength(4);
        expect(result[3]).toBeCloseTo(1, 5); // w component should be ~1 for identity
    });

    it('should apply smoothing factor to reduce jitter', () => {
        const predictor = new PredictiveOrientation(0.1);
        const data1: OrientationData = { alpha: 0, beta: 0, gamma: 0, timestamp: 1000 };
        const data2: OrientationData = { alpha: 90, beta: 0, gamma: 0, timestamp: 1016 };

        predictor.update(data1);
        const result = predictor.update(data2);

        // Result should be interpolated, not exactly at 90 degrees yet
        expect(result[0]).toBeGreaterThan(0);
        expect(result[0]).toBeLessThan(0.707); // 90 deg around X is ~0.707
    });

    it('should extrapolate based on rotation rate', () => {
        const predictor = new PredictiveOrientation(0.15);
        const data: OrientationData = {
            alpha: 0,
            beta: 0,
            gamma: 0,
            rotationRate: { alpha: 0, beta: 90, gamma: 0 }, // 90 deg/sec around X
            timestamp: 1000,
        };

        const result = predictor.update(data);
        expect(result).toHaveLength(4);
        // Should show predictive forward movement
        expect(result[0]).toBeGreaterThan(0);
    });

    it('should normalize quaternion after extrapolation', () => {
        const predictor = new PredictiveOrientation();
        const data: OrientationData = {
            alpha: 45,
            beta: 45,
            gamma: 45,
            rotationRate: { alpha: 100, beta: 100, gamma: 100 },
            timestamp: 1000,
        };

        const result = predictor.update(data);
        const magnitude = Math.sqrt(result[0] ** 2 + result[1] ** 2 + result[2] ** 2 + result[3] ** 2);
        expect(magnitude).toBeCloseTo(1, 5);
    });
});
