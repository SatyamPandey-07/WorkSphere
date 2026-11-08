/**
 * useIndoorPositioning.ts
 * React hook that manages the TrilaterationEngine and processes incoming BLE beacon readings
 * to provide smooth, continuous indoor coordinates.
 */

import { useState, useEffect, useRef } from 'react';
import { TrilaterationEngine, BeaconReading, Position } from '@/lib/spatial/TrilaterationEngine';

export function useIndoorPositioning(beaconReadings: BeaconReading[]) {
    const [position, setPosition] = useState<Position | null>(null);
    const engineRef = useRef<TrilaterationEngine | null>(null);

    useEffect(() => {
        engineRef.current = new TrilaterationEngine(-59, 2.0, 0.3);

        return () => {
            if (engineRef.current) {
                engineRef.current.reset();
            }
        };
    }, []);

    useEffect(() => {
        if (engineRef.current && beaconReadings.length >= 3) {
            const newPos = engineRef.current.calculatePosition(beaconReadings);
            if (newPos) {
                setPosition(newPos);
            }
        } else {
            setPosition(null);
        }
    }, [beaconReadings]);

    return position;
}
