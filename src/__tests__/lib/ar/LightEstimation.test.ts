/**
 * LightEstimation.test.ts
 * Unit tests for the LightEstimation class to ensure proper fallback behavior.
 */

import { LightEstimation } from '@/lib/ar/LightEstimation';

describe('LightEstimation', () => {
    let estimator: LightEstimation;

    beforeEach(() => {
        estimator = new LightEstimation();
    });

    afterEach(() => {
        estimator.destroy();
    });

    it('should return default neutral lighting when no sources are available', () => {
        const data = estimator.getLightingData();

        expect(data.intensity).toBe(1.0);
        expect(data.colorTemperature).toBe(6500);
        expect(data.isEstimated).toBe(false);
    });

    it('should prioritize WebXR estimation when session is provided', async () => {
        const mockSession = {
            lightEstimation: {
                primaryLightIntensity: 1.5,
                primaryLightColorTemperature: 4000,
                primaryLightDirection: new DOMPointReadOnly(0, -1, 0),
            }
        } as unknown as XRSession;

        await estimator.initializeXR(mockSession);
        const data = estimator.getLightingData();

        expect(data.intensity).toBe(1.5);
        expect(data.colorTemperature).toBe(4000);
        expect(data.isEstimated).toBe(true);
    });

    it('should use fallback canvas sampling when video is provided', async () => {
        // Mock video and canvas for testing environment
        const mockVideo = { videoWidth: 100, videoHeight: 100 } as HTMLVideoElement;
        const mockCanvas = {
            getContext: () => ({
                drawImage: jest.fn(),
                getImageData: () => ({
                    data: new Uint8ClampedArray(32 * 32 * 4).fill(128) // Mid-gray
                })
            })
        } as unknown as HTMLCanvasElement;

        // Override internal canvas creation for test
        (estimator as any).fallbackCanvas = mockCanvas;
        await estimator.initializeFallback(mockVideo);

        const data = estimator.getLightingData();

        expect(data.isEstimated).toBe(true);
        expect(data.intensity).toBeGreaterThan(0);
        expect(data.intensity).toBeLessThan(2.0);
    });
});
