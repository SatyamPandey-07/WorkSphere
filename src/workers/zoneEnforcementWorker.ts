/**
 * zoneEnforcementWorker.ts
 * Web Worker that continuously polls the microphone and BLE sensors, 
 * triggering local enforcement actions off-thread.
 */

import { QuietZoneGeofence, Point, Polygon } from '../core/spatial/QuietZoneGeofence';
import { DecibelEnforcementEngine } from '../core/audio/DecibelEnforcementEngine';

export interface WorkerMessage {
    type: 'init' | 'update-location' | 'update-audio' | 'set-zones';
    payload?: any;
}

export interface EnforcementEvent {
    type: 'warning' | 'breach' | 'status';
    severity: 'low' | 'medium' | 'high';
    message: string;
    data?: any;
}

class ZoneEnforcementManager {
    private geofence: QuietZoneGeofence = new QuietZoneGeofence();
    private audioEngine: DecibelEnforcementEngine = new DecibelEnforcementEngine(60, 10, 2); // 10s window, 2 samples/sec
    private currentLocation: Point | null = null;
    private currentZone: Polygon | null = null;
    private warningCooldownMs: number = 30000; // 30 seconds
    private lastWarningTime: number = 0;

    public setZones(zones: Polygon[]) {
        // Clear existing
        for (const zone of this.geofence.getAllZones()) {
            this.geofence.removeZone(zone.id);
        }
        // Add new
        for (const zone of zones) {
            this.geofence.addZone(zone);
        }
        this.postEvent({
            type: 'status',
            severity: 'low',
            message: `Loaded ${zones.length} quiet zones`,
        });
    }

    public updateLocation(point: Point) {
        this.currentLocation = point;
        this.checkZoneTransition();
    }

    public updateAudio(dbLevel: number) {
        this.audioEngine.pushReading(dbLevel);
        this.checkAudioBreach();
    }

    private checkZoneTransition() {
        if (!this.currentLocation) return;

        const newZone = this.geofence.getCurrentZone(this.currentLocation);

        if (newZone && !this.currentZone) {
            // Entered a quiet zone
            this.currentZone = newZone;
            this.audioEngine.setThreshold(newZone.maxDecibels);
            this.audioEngine.reset(); // Reset audio buffer when entering new zone

            this.postEvent({
                type: 'status',
                severity: 'low',
                message: `Entered Quiet Zone: ${newZone.name}. Max ${newZone.maxDecibels}dB.`,
            });
        } else if (!newZone && this.currentZone) {
            // Left a quiet zone
            this.currentZone = null;
            this.audioEngine.setThreshold(100); // Effectively disable enforcement outside zones
            this.audioEngine.reset();

            this.postEvent({
                type: 'status',
                severity: 'low',
                message: 'Left Quiet Zone. Enforcement disabled.',
            });
        }
    }

    private checkAudioBreach() {
        if (!this.currentZone) return; // Only enforce inside quiet zones

        const analysis = this.audioEngine.analyze();

        if (analysis.isBreaching) {
            const now = Date.now();
            if (now - this.lastWarningTime > this.warningCooldownMs) {
                this.lastWarningTime = now;

                this.postEvent({
                    type: 'warning',
                    severity: analysis.averageDb > this.currentZone.maxDecibels + 10 ? 'high' : 'medium',
                    message: `Noise level (${analysis.currentDb.toFixed(1)}dB) exceeds limit (${this.currentZone.maxDecibels}dB) in ${this.currentZone.name}.`,
                    data: analysis,
                });
            }
        }
    }

    private postEvent(event: EnforcementEvent) {
        self.postMessage(event);
    }
}

const manager = new ZoneEnforcementManager();

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const { type, payload } = event.data;

    if (type === 'set-zones') {
        manager.setZones(payload.zones);
    } else if (type === 'update-location') {
        manager.updateLocation(payload as Point);
    } else if (type === 'update-audio') {
        manager.updateAudio(payload.dbLevel);
    }
};

self.postMessage({ type: 'worker-ready' });
