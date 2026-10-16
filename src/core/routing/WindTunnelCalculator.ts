/**
 * WindTunnelCalculator.ts
 * Evaluates OSM building height data against wind-direction vectors 
 * to predict and penalize high-velocity urban wind corridors.
 */

export interface Building {
    id: string;
    footprint: { lat: number; lon: number }[];
    height: number; // meters
}

export interface WindVector {
    speed: number; // m/s
    directionDeg: number; // 0-360, 0 = North
}

export interface StreetSegment {
    id: string;
    start: { lat: number; lon: number };
    end: { lat: number; lon: number };
    width: number; // meters
    adjacentBuildings: string[]; // IDs of buildings forming the canyon
}

export class WindTunnelCalculator {
    private buildings: Map<string, Building> = new Map();

    public loadBuildings(buildings: Building[]): void {
        for (const b of buildings) {
            this.buildings.set(b.id, b);
        }
    }

    /**
     * Calculates the localized wind speed on a street segment using the 
     * urban canyon venturi effect heuristic.
     */
    public calculateSegmentWindSpeed(segment: StreetSegment, ambientWind: WindVector): number {
        if (segment.adjacentBuildings.length < 2) {
            return ambientWind.speed; // Open area, no canyon effect
        }

        let maxBuildingHeight = 0;
        let totalHeight = 0;

        for (const bId of segment.adjacentBuildings) {
            const b = this.buildings.get(bId);
            if (b) {
                maxBuildingHeight = Math.max(maxBuildingHeight, b.height);
                totalHeight += b.height;
            }
        }

        const avgHeight = totalHeight / segment.adjacentBuildings.length;

        // Calculate street orientation
        const streetAngle = this.calculateBearing(segment.start, segment.end);

        // Calculate angle difference between wind and street
        const angleDiff = Math.abs(this.normalizeAngle(ambientWind.directionDeg - streetAngle));

        // Venturi effect factor: Wind parallel to the street is accelerated
        // Wind perpendicular is blocked or creates turbulence
        const parallelFactor = Math.cos(this.toRadians(angleDiff));

        // Height-to-width ratio (H/W) determines canyon intensity
        const hwRatio = avgHeight / Math.max(segment.width, 5);

        // Base acceleration factor
        let acceleration = 1.0;

        if (hwRatio > 0.65) {
            // Deep canyon: strong venturi effect if wind is parallel
            acceleration += (hwRatio * Math.abs(parallelFactor) * 0.5);
        } else if (hwRatio > 0.3) {
            // Shallow canyon: wake interference and turbulence
            acceleration += (hwRatio * 0.2);
        }

        // Downwash effect from very tall buildings
        if (maxBuildingHeight > 40) {
            acceleration += (maxBuildingHeight / 100) * 0.3;
        }

        return ambientWind.speed * acceleration;
    }

    /**
     * Calculates turbulence penalty (0.0 to 1.0) based on cross-winds and building corners.
     */
    public calculateTurbulenceIndex(segment: StreetSegment, ambientWind: WindVector): number {
        const streetAngle = this.calculateBearing(segment.start, segment.end);
        const angleDiff = Math.abs(this.normalizeAngle(ambientWind.directionDeg - streetAngle));

        // Cross-winds create high turbulence in canyons
        const crossWindFactor = Math.abs(Math.sin(this.toRadians(angleDiff)));

        let turbulence = 0;
        if (segment.adjacentBuildings.length >= 2) {
            turbulence = crossWindFactor * 0.6;
        }

        return Math.min(turbulence, 1.0);
    }

    private calculateBearing(start: { lat: number; lon: number }, end: { lat: number; lon: number }): number {
        const dLon = this.toRadians(end.lon - start.lon);
        const y = Math.sin(dLon) * Math.cos(this.toRadians(end.lat));
        const x = Math.cos(this.toRadians(start.lat)) * Math.sin(this.toRadians(end.lat)) -
            Math.sin(this.toRadians(start.lat)) * Math.cos(this.toRadians(end.lat)) * Math.cos(dLon);
        const brng = Math.atan2(y, x);
        return (this.toDegrees(brng) + 360) % 360;
    }

    private normalizeAngle(angle: number): number {
        angle = angle % 360;
        if (angle > 180) angle -= 360;
        if (angle < -180) angle += 360;
        return angle;
    }

    private toRadians(deg: number): number {
        return deg * (Math.PI / 180);
    }

    private toDegrees(rad: number): number {
        return rad * (180 / Math.PI);
    }
}
