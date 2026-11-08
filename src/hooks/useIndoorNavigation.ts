/**
 * useIndoorNavigation.ts
 * Custom React hook that manages the worker lifecycle and exposes smoothed indoor coordinates to the UI.
 * Provides a clean API for components to subscribe to real-time indoor positioning updates.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

export interface IndoorPosition {
    x: number;
    y: number;
    z: number;
    accuracy: number;
    apsUsed: number;
    isAvailable: boolean;
}

export function useIndoorNavigation(venueId: string) {
    const [position, setPosition] = useState<IndoorPosition>({
        x: 0, y: 0, z: 0, accuracy: 0, apsUsed: 0, isAvailable: false
    });
    const workerRef = useRef<Worker | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (typeof Worker !== 'undefined') {
            workerRef.current = new Worker(new URL('../workers/wifiScanningWorker.ts', import.meta.url), {
                type: 'module'
            });

            workerRef.current.onmessage = (event) => {
                if (event.data.type === 'INITIALIZED') {
                    setPosition(prev => ({ ...prev, isAvailable: true }));
                } else if (event.data.type === 'POSITION_UPDATE') {
                    if (event.data.error) {
                        setError(event.data.error);
                    } else if (
                        event.data.payload &&
                        Number.isFinite(event.data.payload.x) &&
                        Number.isFinite(event.data.payload.y)
                    ) {
                        setPosition({
                            x: event.data.payload.x,
                            y: event.data.payload.y,
                            z: event.data.payload.z ?? 0,
                            accuracy: event.data.payload.accuracy ?? 0,
                            apsUsed: event.data.payload.apsUsed ?? 0,
                            isAvailable: true
                        });
                        setError(null);
                    }
                }
            };

            workerRef.current.onerror = (err) => {
                setError('Web Worker failed to initialize');
                console.error('Worker error:', err);
            };

            workerRef.current.postMessage({
                type: 'INIT',
                payload: { processNoise: 0.1, measurementNoise: 1.0, dt: 1.0 }
            });
        } else {
            setError('Web Workers are not supported in this browser');
        }

        return () => {
            if (workerRef.current) {
                workerRef.current.terminate();
            }
        };
    }, [venueId]);

    const submitScan = useCallback((accessPoints: any[]) => {
        if (workerRef.current) {
            workerRef.current.postMessage({
                type: 'PROCESS_SCAN',
                payload: { accessPoints }
            });
        }
    }, []);

    return { position, submitScan, error };
}
