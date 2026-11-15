/**
 * Translates 3D spatial vectors and proximity deltas into custom, 
 * directional vibration sequences using the Vibration API.
 */

export interface SpatialCoordinate {
    x: number;
    y: number;
    z: number;
}

export interface HapticPattern {
    name: string;
    sequence: number[]; // Array of milliseconds (vibrate, pause, vibrate, pause)
}

export class HapticAnchorEngine {
    private isSupported: boolean;
    private patterns: Map<string, HapticPattern> = new Map();

    constructor() {
        this.isSupported = typeof navigator !== 'undefined' && 'vibrate' in navigator;
        this.initializePatterns();
    }

    private initializePatterns(): void {
        this.patterns.set('heartbeat', { name: 'heartbeat', sequence: [100, 50, 100, 1000] });
        this.patterns.set('pulse_near', { name: 'pulse_near', sequence: [50, 100, 50, 500] });
        this.patterns.set('pulse_far', { name: 'pulse_far', sequence: [20, 200, 20, 2000] });
        this.patterns.set('arrived', { name: 'arrived', sequence: [300, 100, 300, 100, 300] });
        this.patterns.set('directional_left', { name: 'directional_left', sequence: [150, 50, 50, 500] });
        this.patterns.set('directional_right', { name: 'directional_right', sequence: [50, 50, 150, 500] });
    }

    /**
     * Calculates the distance and bearing between two 3D coordinates.
     */
    public calculateVectorDelta(origin: SpatialCoordinate, target: SpatialCoordinate): { distance: number; bearing: number } {
        const dx = target.x - origin.x;
        const dy = target.y - origin.y;
        const dz = target.z - origin.z;

        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        // Bearing in degrees (0 = North/Y+, 90 = East/X+)
        const bearing = (Math.atan2(dx, dy) * 180) / Math.PI;

        return { distance, bearing: (bearing + 360) % 360 };
    }

    /**
     * Determines the appropriate haptic pattern based on distance and relative heading.
     */
    public getPatternForProximity(distance: number, userHeading: number, targetBearing: number): string {
        if (distance < 2) return 'arrived';
        if (distance < 10) return 'heartbeat';
        if (distance < 30) return 'pulse_near';

        // Directional cues for far targets
        const relativeBearing = (targetBearing - userHeading + 360) % 360;
        if (relativeBearing > 180) return 'directional_left';
        return 'directional_right';
    }

    /**
     * Triggers the device vibration API with the selected pattern.
     */
    public trigger(patternName: string): boolean {
        if (!this.isSupported) return false;

        const pattern = this.patterns.get(patternName);
        if (!pattern) return false;

        try {
            navigator.vibrate(pattern.sequence);
            return true;
        } catch (error) {
            console.error('[HapticEngine] Vibration failed:', error);
            return false;
        }
    }

    public stop(): void {
        if (this.isSupported) {
            navigator.vibrate(0);
        }
    }
}
