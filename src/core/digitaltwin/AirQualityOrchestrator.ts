/**
 * @file AirQualityOrchestrator.ts
 * @description Maps real-time CO2 and VOC sensor data to the venue's 3D spatial 
 * tree, identifying stale-air dead zones and triggering automated HVAC purge cycles.
 */

export interface SpatialZone {
    id: string;
    name: string;
    capacity: number;
    currentOccupancy: number;
    volumeCubicMeters: number;
    co2Level: number; // ppm
    vocLevel: number; // ppb
    lastUpdated: number;
}

export interface PurgeCommand {
    zoneId: string;
    action: 'purge' | 'maintain' | 'reduce';
    targetCo2: number;
    estimatedDurationMs: number;
}

export class AirQualityOrchestrator {
    private zones: Map<string, SpatialZone>;
    private readonly CO2_THRESHOLD_PURGE = 1000; // ppm
    private readonly CO2_THRESHOLD_WARNING = 800; // ppm
    private readonly VOC_THRESHOLD = 500; // ppb
    private readonly ACH_RATE = 4; // Air Changes per Hour baseline

    constructor() {
        this.zones = new Map();
    }

    public registerZone(zone: Omit<SpatialZone, 'co2Level' | 'vocLevel' | 'lastUpdated'>): void {
        this.zones.set(zone.id, {
            ...zone,
            co2Level: 400, // Baseline outdoor CO2
            vocLevel: 0,
            lastUpdated: Date.now(),
        });
    }

    public updateSensorData(zoneId: string, co2: number, voc: number, occupancy?: number): SpatialZone | null {
        const zone = this.zones.get(zoneId);
        if (!zone) return null;

        zone.co2Level = co2;
        zone.vocLevel = voc;
        zone.lastUpdated = Date.now();

        if (occupancy !== undefined) {
            zone.currentOccupancy = occupancy;
        }

        return zone;
    }

    public evaluateZoneHealth(zoneId: string): { status: 'optimal' | 'warning' | 'critical'; command: PurgeCommand | null } {
        const zone = this.zones.get(zoneId);
        if (!zone) return { status: 'optimal', command: null };

        let status: 'optimal' | 'warning' | 'critical' = 'optimal';
        let command: PurgeCommand | null = null;

        if (zone.co2Level >= this.CO2_THRESHOLD_PURGE || zone.vocLevel >= this.VOC_THRESHOLD) {
            status = 'critical';
            command = this.generatePurgeCommand(zone);
        } else if (zone.co2Level >= this.CO2_THRESHOLD_WARNING) {
            status = 'warning';
            command = {
                zoneId: zone.id,
                action: 'maintain',
                targetCo2: 600,
                estimatedDurationMs: 0,
            };
        }

        return { status, command };
    }

    private generatePurgeCommand(zone: SpatialZone): PurgeCommand {
        // Calculate required fresh air based on ASHRAE 62.1 standards
        const requiredCFM = zone.currentOccupancy * 15; // 15 CFM per person
        const currentCFM = (zone.volumeCubicMeters * this.ACH_RATE) / 60;

        const deficitCFM = Math.max(0, requiredCFM - currentCFM);
        const purgeMultiplier = deficitCFM > 0 ? 2 : 1.5;

        // Estimate time to flush based on volume and deficit
        const volumeToFlush = zone.volumeCubicMeters * 0.8; // Flush 80% of volume
        const flushRate = (currentCFM * purgeMultiplier) / 60; // cubic meters per second
        const durationMs = flushRate > 0 ? (volumeToFlush / flushRate) * 1000 : 900000;

        return {
            zoneId: zone.id,
            action: 'purge',
            targetCo2: 500,
            estimatedDurationMs: Math.min(durationMs, 3600000), // Cap at 1 hour
        };
    }

    public getAllZoneStatuses(): Array<{ zone: SpatialZone; status: 'optimal' | 'warning' | 'critical' }> {
        const results = [];
        for (const zone of this.zones.values()) {
            const { status } = this.evaluateZoneHealth(zone.id);
            results.push({ zone, status });
        }
        return results;
    }
}
