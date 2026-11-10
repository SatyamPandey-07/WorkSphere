export interface AcousticZone {
    zoneId: string;
    coordinates: { x: number; y: number; z: number };
    rt60: number; // Reverberation time in seconds
    callQualityScore: number; // 0-100
}

/**
 * Correlates the calculated RT60 metrics with the user's BLE indoor 
 * coordinates to build a venue acoustic heatmap.
 */
export class SpatialReverbMapper {
    private zones: Map<string, AcousticZone> = new Map();

    public updateZone(zoneId: string, coords: { x: number, y: number, z: number }, rt60: number): void {
        const callQuality = this.calculateCallQuality(rt60);
        this.zones.set(zoneId, {
            zoneId,
            coordinates: coords,
            rt60,
            callQualityScore: callQuality,
        });
    }

    public getHeatmapData(): AcousticZone[] {
        return Array.from(this.zones.values());
    }

    /**
     * Calculates a 0-100 score for Zoom/Teams call quality based on RT60.
     * Optimal RT60 for speech is 0.3s - 0.6s.
     */
    private calculateCallQuality(rt60: number): number {
        if (rt60 <= 0) return 0;
        if (rt60 >= 0.3 && rt60 <= 0.6) return 100;
        if (rt60 < 0.3) return 80; // Too dead, but acceptable
        if (rt60 > 0.6 && rt60 <= 1.0) return 60; // Slightly echoey
        if (rt60 > 1.0 && rt60 <= 1.5) return 30; // Poor
        return 10; // Unusable for calls
    }
}
