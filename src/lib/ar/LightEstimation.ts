/**
 * LightEstimation.ts
 * Estimates ambient lighting conditions for AR scenes using WebXR Light Estimation API,
 * with a canvas-based luminance fallback for devices without WebXR support.
 */

export interface LightingData {
    intensity: number; // 0.0 to 2.0+
    colorTemperature: number; // in Kelvin (e.g., 6500 for daylight)
    isEstimated: boolean;
}

export class LightEstimation {
    private xrSession: XRSession | null;
    private fallbackCanvas: HTMLCanvasElement | null;
    private fallbackVideo: HTMLVideoElement | null;
    private fallbackActive: boolean;

    constructor() {
        this.xrSession = null;
        this.fallbackCanvas = null;
        this.fallbackVideo = null;
        this.fallbackActive = false;
    }

    public async initializeXR(session: XRSession): Promise<void> {
        this.xrSession = session;
    }

    public async initializeFallback(videoElement: HTMLVideoElement): Promise<void> {
        this.fallbackVideo = videoElement;
        this.fallbackCanvas = document.createElement('canvas');
        this.fallbackCanvas.width = 32; // Low res for performance
        this.fallbackCanvas.height = 32;
        this.fallbackActive = true;
    }

    public getLightingData(): LightingData {
        // 1. Try WebXR Light Estimation
        if (this.xrSession && this.xrSession.lightEstimation) {
            const estimate = this.xrSession.lightEstimation;
            if (estimate.primaryLightIntensity && estimate.primaryLightDirection) {
                return {
                    intensity: estimate.primaryLightIntensity,
                    colorTemperature: estimate.primaryLightColorTemperature || 6500,
                    isEstimated: true,
                };
            }
        }

        // 2. Fallback to canvas luminance sampling
        if (this.fallbackActive && this.fallbackVideo && this.fallbackCanvas) {
            return this.sampleVideoLuminance();
        }

        // 3. Default neutral lighting
        return {
            intensity: 1.0,
            colorTemperature: 6500,
            isEstimated: false,
        };
    }

    private sampleVideoLuminance(): LightingData {
        const ctx = this.fallbackCanvas!.getContext('2d');
        if (!ctx || !this.fallbackVideo) {
            return { intensity: 1.0, colorTemperature: 6500, isEstimated: false };
        }

        // Draw a small frame from the video
        ctx.drawImage(this.fallbackVideo, 0, 0, 32, 32);
        const imageData = ctx.getImageData(0, 0, 32, 32);
        const data = imageData.data;

        let totalLuminance = 0;
        let totalR = 0;
        let totalG = 0;
        let totalB = 0;
        const pixelCount = data.length / 4;

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            // Relative luminance formula
            const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            totalLuminance += luminance;

            totalR += r;
            totalG += g;
            totalB += b;
        }

        const avgLuminance = totalLuminance / pixelCount;
        const avgR = totalR / pixelCount;
        const avgG = totalG / pixelCount;
        const avgB = totalB / pixelCount;

        // Normalize intensity (0-255 -> 0.0-2.0)
        const normalizedIntensity = (avgLuminance / 255) * 2.0;

        // Rough color temperature estimation based on RGB ratios
        let colorTemp = 6500;
        if (avgR > avgB * 1.2) {
            colorTemp = 3000; // Warm
        } else if (avgB > avgR * 1.2) {
            colorTemp = 8000; // Cool
        }

        return {
            intensity: Math.max(0.1, normalizedIntensity),
            colorTemperature: colorTemp,
            isEstimated: true,
        };
    }

    public destroy(): void {
        this.xrSession = null;
        this.fallbackCanvas = null;
        this.fallbackVideo = null;
        this.fallbackActive = false;
    }
}
