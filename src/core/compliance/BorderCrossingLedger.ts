/**
 * Tracks precise GPS coordinates against global border polygons to log 
 * exact entry and exit timestamps for tax calculations.
 */

export interface GeoCoordinate {
    lat: number;
    lon: number;
    timestamp: number;
}

export interface BorderPolygon {
    countryId: string;
    name: string;
    vertices: { lat: number; lon: number }[];
    taxThresholdDays: number; // e.g., 183 days
}

export interface ResidencySession {
    countryId: string;
    entryTimestamp: number;
    exitTimestamp: number | null;
    durationDays: number;
}

export class BorderCrossingLedger {
    private sessions: ResidencySession[] = [];
    private currentCountry: string | null = null;
    private entryTime: number = 0;

    constructor() { }

    /**
     * Evaluates a new GPS coordinate and updates the ledger if a border crossing is detected.
     */
    public processCoordinate(coord: GeoCoordinate, borders: BorderPolygon[]): void {
        const detectedCountry = this.pointInPolygons(coord, borders);

        if (detectedCountry !== this.currentCountry) {
            // Border crossing detected
            if (this.currentCountry !== null) {
                // Close previous session
                const exitTime = coord.timestamp;
                const durationMs = exitTime - this.entryTime;
                const durationDays = durationMs / (1000 * 60 * 60 * 24);

                this.sessions.push({
                    countryId: this.currentCountry,
                    entryTimestamp: this.entryTime,
                    exitTimestamp: exitTime,
                    durationDays: Math.round(durationDays * 100) / 100,
                });
            }

            // Start new session
            this.currentCountry = detectedCountry;
            this.entryTime = coord.timestamp;
        }
    }

    /**
     * Calculates the total days spent in a specific country over a rolling period.
     */
    public getDaysInCountry(countryId: string, startDate: number, endDate: number): number {
        let totalDays = 0;

        for (const session of this.sessions) {
            if (session.countryId !== countryId) continue;

            const sessionStart = Math.max(session.entryTimestamp, startDate);
            const sessionEnd = Math.min(session.exitTimestamp || Date.now(), endDate);

            if (sessionEnd > sessionStart) {
                const durationMs = sessionEnd - sessionStart;
                totalDays += durationMs / (1000 * 60 * 60 * 24);
            }
        }

        return Math.round(totalDays * 100) / 100;
    }

    public getSessions(): ResidencySession[] {
        return [...this.sessions];
    }

    /**
     * Ray-casting algorithm to determine if a point is inside a set of polygons.
     * Returns the countryId of the polygon containing the point, or null.
     */
    private pointInPolygons(coord: GeoCoordinate, borders: BorderPolygon[]): string | null {
        for (const border of borders) {
            if (this.isPointInPolygon(coord, border.vertices)) {
                return border.countryId;
            }
        }
        return null; // International waters or untracked zone
    }

    private isPointInPolygon(point: GeoCoordinate, vertices: { lat: number; lon: number }[]): boolean {
        let inside = false;
        const x = point.lat;
        const y = point.lon;

        for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
            const xi = vertices[i].lat, yi = vertices[i].lon;
            const xj = vertices[j].lat, yj = vertices[j].lon;

            const intersect = ((yi > y) !== (yj > y)) &&
                (x < (xj - xi) * (y - yi) / (yj - yi) + xi);

            if (intersect) inside = !inside;
        }

        return inside;
    }
}
