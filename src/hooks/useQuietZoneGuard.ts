/**
 * useQuietZoneGuard.ts
 * Custom React hook that manages the worker lifecycle and renders the non-intrusive UI warnings.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { EnforcementEvent } from '../workers/zoneEnforcementWorker';
import type { Polygon, Point } from '../core/spatial/QuietZoneGeofence';

export interface UseQuietZoneGuardOptions {
    enabled: boolean;
    venueId: string;
}

export interface QuietZoneState {
    isInQuietZone: boolean;
    zoneName: string | null;
    currentDb: number;
    maxDb: number;
    warningMessage: string | null;
    severity: 'low' | 'medium' | 'high' | null;
}

export function useQuietZoneGuard(options: UseQuietZoneGuardOptions) {
    const { enabled, venueId } = options;
    const workerRef = useRef<Worker | null>(null);

    const [state, setState] = useState<QuietZoneState>({
        isInQuietZone: false,
        zoneName: null,
        currentDb: 0,
        maxDb: 0,
        warningMessage: null,
        severity: null,
    });

    const initWorker = useCallback(async () => {
        if (workerRef.current) return;

        // In Next.js, use the standard Worker constructor with the public path or a dynamic import
        // For this example, we assume the worker is bundled and available at a specific path
        const worker = new Worker(new URL('../workers/zoneEnforcementWorker.ts', import.meta.url));
        workerRef.current = worker;

        worker.onmessage = (event: MessageEvent<EnforcementEvent>) => {
            const msg = event.data;

            if (msg.type === 'warning') {
                setState((prev) => ({
                    ...prev,
                    warningMessage: msg.message,
                    severity: msg.severity,
                    currentDb: msg.data?.currentDb || prev.currentDb,
                }));

                // Auto-clear warning after 5 seconds
                setTimeout(() => {
                    setState((prev) => ({
                        ...prev,
                        warningMessage: null,
                        severity: null,
                    }));
                }, 5000);
            } else if (msg.type === 'status') {
                const isEntering = msg.message.includes('Entered');
                const isLeaving = msg.message.includes('Left');

                if (isEntering) {
                    const zoneName = msg.message.split(':')[1]?.split('.')[0].trim() || 'Unknown';
                    const maxDbMatch = msg.message.match(/Max (\d+)dB/);
                    const maxDb = maxDbMatch ? parseInt(maxDbMatch[1]) : 60;

                    setState((prev) => ({
                        ...prev,
                        isInQuietZone: true,
                        zoneName,
                        maxDb,
                        warningMessage: null,
                    }));
                } else if (isLeaving) {
                    setState((prev) => ({
                        ...prev,
                        isInQuietZone: false,
                        zoneName: null,
                        maxDb: 0,
                        warningMessage: null,
                    }));
                }
            }
        };

        // Fetch zones from API
        try {
            const response = await fetch(`/api/venues/zones?venueId=${venueId}`);
            const data = await response.json();
            if (data.success && data.data) {
                worker.postMessage({ type: 'set-zones', payload: { zones: data.data } });
            }
        } catch (err) {
            console.error('[useQuietZoneGuard] Failed to fetch zones:', err);
        }
    }, [venueId]);

    useEffect(() => {
        if (enabled) {
            initWorker();
        }

        return () => {
            if (workerRef.current) {
                workerRef.current.terminate();
                workerRef.current = null;
            }
        };
    }, [enabled, initWorker]);

    const updateLocation = useCallback((point: Point) => {
        if (workerRef.current && enabled) {
            workerRef.current.postMessage({ type: 'update-location', payload: point });
        }
    }, [enabled]);

    const updateAudio = useCallback((dbLevel: number) => {
        if (workerRef.current && enabled) {
            workerRef.current.postMessage({ type: 'update-audio', payload: { dbLevel } });
        }
    }, [enabled]);

    return {
        state,
        updateLocation,
        updateAudio,
    };
}
