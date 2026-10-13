/**
 * usePredictiveGyroscope.ts
 * React hook that interfaces with the DeviceOrientationEvent API and applies
 * predictive quaternion smoothing for AR pointer rendering.
 */

import { useState, useEffect, useRef } from 'react';
import { PredictiveOrientation, OrientationData } from '@/lib/ar/PredictiveOrientation';

export function usePredictiveGyroscope(smoothingFactor: number = 0.15): number[] {
    const [orientation, setOrientation] = useState<number[]>([0, 0, 0, 1]);
    const predictorRef = useRef(new PredictiveOrientation(smoothingFactor));
    const rafRef = useRef<number | null>(null);

    useEffect(() => {
        const handleOrientation = (event: DeviceOrientationEvent) => {
            const data: OrientationData = {
                alpha: event.alpha || 0,
                beta: event.beta || 0,
                gamma: event.gamma || 0,
                rotationRate: event.rotationRate || undefined,
                timestamp: event.timeStamp || Date.now(),
            };

            const smoothedQ = predictorRef.current.update(data);
            setOrientation(smoothedQ);
        };

        // Request permission for iOS 13+ devices
        if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
            (DeviceOrientationEvent as any).requestPermission()
                .then((response: string) => {
                    if (response === 'granted') {
                        window.addEventListener('deviceorientation', handleOrientation, true);
                    }
                })
                .catch(console.error);
        } else {
            window.addEventListener('deviceorientation', handleOrientation, true);
        }

        return () => {
            window.removeEventListener('deviceorientation', handleOrientation, true);
            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current);
            }
            predictorRef.current.reset();
        };
    }, [smoothingFactor]);

    return orientation;
}
