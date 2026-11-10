/**
 * Web Worker that continuously evaluates proximity thresholds and triggers 
 * haptic events without blocking UI interactions.
 */

import { HapticAnchorEngine, SpatialCoordinate } from '../core/spatial/HapticAnchorEngine';
import { BLEProximityFusion, BeaconReading } from '../core/spatial/BLEProximityFusion';

const hapticEngine = new HapticAnchorEngine();
const fusionEngine = new BLEProximityFusion();

interface TargetState {
    id: string;
    coordinate: SpatialCoordinate;
    lastDistance: number;
    lastTriggerTime: number;
}

let userCoordinate: SpatialCoordinate = { x: 0, y: 0, z: 0 };
let userHeading: number = 0;
let targets: Map<string, TargetState> = new Map();
let isRunning = false;
let evaluationInterval: number | null = null;

self.onmessage = (event: MessageEvent) => {
    const { type, payload } = event.data;

    switch (type) {
        case 'START':
            if (!isRunning) {
                isRunning = true;
                // Evaluate proximity every 500ms to save battery
                evaluationInterval = self.setInterval(evaluateProximity, 500) as unknown as number;
            }
            break;

        case 'STOP':
            if (isRunning && evaluationInterval !== null) {
                clearInterval(evaluationInterval);
                isRunning = false;
                hapticEngine.stop();
            }
            break;

        case 'UPDATE_USER_STATE':
            userCoordinate = payload.coordinate;
            userHeading = payload.heading;
            break;

        case 'UPDATE_TARGETS':
            targets.clear();
            payload.targets.forEach((t: any) => {
                targets.set(t.id, { ...t, lastDistance: Infinity, lastTriggerTime: 0 });
            });
            break;

        case 'BLE_READING':
            const reading = payload as BeaconReading;
            const distance = fusionEngine.processReading(reading);
            // Map BLE MAC to Target ID (simplified mapping logic)
            const targetId = reading.macAddress;
            const target = targets.get(targetId);
            if (target) {
                target.lastDistance = distance;
            }
            break;
    }
};

function evaluateProximity() {
    const now = Date.now();

    for (const [id, target] of targets.entries()) {
        if (target.lastDistance === Infinity) continue;

        const delta = hapticEngine.calculateVectorDelta(userCoordinate, target.coordinate);
        const patternName = hapticEngine.getPatternForProximity(
            target.lastDistance,
            userHeading,
            delta.bearing
        );

        // Throttle haptic triggers to prevent overwhelming the user
        const cooldown = patternName === 'arrived' ? 5000 : 2000;

        if (now - target.lastTriggerTime > cooldown) {
            const triggered = hapticEngine.trigger(patternName);
            if (triggered) {
                target.lastTriggerTime = now;
                self.postMessage({
                    type: 'HAPTIC_TRIGGERED',
                    payload: { targetId: id, pattern: patternName, distance: target.lastDistance }
                });
            }
        }
    }
}
