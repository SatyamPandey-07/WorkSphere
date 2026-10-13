/**
 * useWebXRLightEstimation.ts
 * React hook that provides real-time lighting data to update Three.js scene illumination.
 */

import { useState, useEffect, useRef } from 'react';
import { LightEstimation, LightingData } from '@/lib/ar/LightEstimation';

export function useWebXRLightEstimation(
    xrSession: XRSession | null,
    videoElement: HTMLVideoElement | null
): LightingData {
    const [lighting, setLighting] = useState<LightingData>({
        intensity: 1.0,
        colorTemperature: 6500,
        isEstimated: false,
    });

    const estimatorRef = useRef(new LightEstimation());
    const rafRef = useRef<number | null>(null);

    useEffect(() => {
        const estimator = estimatorRef.current;

        if (xrSession) {
            estimator.initializeXR(xrSession);
        } else if (videoElement) {
            estimator.initializeFallback(videoElement);
        }

        const updateLighting = () => {
            const data = estimator.getLightingData();
            setLighting(data);
            rafRef.current = requestAnimationFrame(updateLighting);
        };

        rafRef.current = requestAnimationFrame(updateLighting);

        return () => {
            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current);
            }
            estimator.destroy();
        };
    }, [xrSession, videoElement]);

    return lighting;
}
