/**
 * UVExposureScorer.ts
 * Calculates cumulative UV and thermal comfort indices based on the 
 * user's walking speed and the path's shade coverage.
 */

export interface SolarPosition {
    altitude: number; // degrees above horizon
    azimuth: number; // degrees from North
}

export interface ShadeObstacle {
    id: string;
    type: 'building' | 'tree' | 'awning';
    bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
    height: number;
}

export class UVExposureScorer {
    private latitude: number;
    private longitude: number;
    private shadeObstacles: ShadeObstacle[] = [];

    constructor(latitude: number, longitude: number) {
        this.latitude = latitude;
        this.longitude = longitude;
    }

    public loadShadeObstacles(obstacles: ShadeObstacle[]): void {
        this.shadeObstacles = obstacles;
    }

    /**
     * Calculates the sun's position for a given timestamp.
     * Uses simplified astronomical algorithms sufficient for urban shading.
     */
    public calculateSolarPosition(timestamp: number): SolarPosition {
        const date = new Date(timestamp);
        const dayOfYear = this.getDayOfYear(date);

        // Solar declination
        const declination = 23.45 * Math.sin(this.toRadians((360 / 365) * (dayOfYear - 81)));

        // Hour angle (15 degrees per hour from solar noon)
        const solarNoon = 12; // Simplified, ignoring timezone/equation of time for demo
        const hour = date.getHours() + date.getMinutes() / 60;
        const hourAngle = 15 * (hour - solarNoon);

        const latRad = this.toRadians(this.latitude);
        const decRad = this.toRadians(declination);
        const haRad = this.toRadians(hourAngle);

        // Solar altitude
        const sinAlt = Math.sin(latRad) * Math.sin(decRad) +
            Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);
        const altitude = this.toDegrees(Math.asin(sinAlt));

        // Solar azimuth
        const cosAz = (Math.sin(decRad) - Math.sin(latRad) * sinAlt) /
            (Math.cos(latRad) * Math.cos(this.toRadians(altitude)));
        let azimuth = this.toDegrees(Math.acos(Math.max(-1, Math.min(1, cosAz))));

        if (hourAngle > 0) azimuth = 360 - azimuth;

        return { altitude, azimuth };
    }

    /**
     * Calculates the effective UV dose for a specific path segment.
     */
    public calculateSegmentUVDose(
        segmentLat: number,
        segmentLon: number,
        ambientUVIndex: number,
        solarPos: SolarPosition,
        walkingSpeedMps: number,
        segmentLengthM: number
    ): number {
        if (solarPos.altitude <= 0) return 0; // Nighttime

        const timeOnSegment = segmentLengthM / walkingSpeedMps; // seconds
        const shadeFactor = this.calculateShadeFactor(segmentLat, segmentLon, solarPos);

        // UV Index to UV Irradiance (approx 25 mW/m^2 per UVI)
        const irradiance = ambientUVIndex * 25;

        // Effective dose = Irradiance * time * (1 - shade)
        const dose = irradiance * timeOnSegment * (1 - shadeFactor);

        return dose;
    }

    /**
     * Raycasts from the sun through the point to check for shade obstacles.
     */
    private calculateShadeFactor(lat: number, lon: number, solarPos: SolarPosition): number {
        if (solarPos.altitude <= 0) return 1.0; // Night = full "shade"

        let maxShade = 0;

        for (const obs of this.shadeObstacles) {
            // Simplified bounding box check + height projection
            if (lat >= obs.bounds.minLat && lat <= obs.bounds.maxLat &&
                lon >= obs.bounds.minLon && lon <= obs.bounds.maxLon) {

                // If the sun is low, buildings cast long shadows
                const shadowLength = obs.height / Math.tan(this.toRadians(solarPos.altitude));

                // Mocking the exact shadow projection: if the point is within the shadow cast
                // For simplicity, if inside bounds and sun altitude < 45, assume shaded
                if (solarPos.altitude < 45) {
                    maxShade = Math.max(maxShade, obs.type === 'tree' ? 0.6 : 0.95);
                } else {
                    maxShade = Math.max(maxShade, obs.type === 'tree' ? 0.3 : 0.5);
                }
            }
        }

        return Math.min(maxShade, 1.0);
    }

    public evaluateThermalComfort(tempC: number, humidity: number, windSpeed: number, isShaded: boolean): number {
        // Simplified Universal Thermal Climate Index (UTCI) heuristic
        let feelsLike = tempC;

        if (tempC > 27 && humidity > 40) {
            // Heat index adjustment
            feelsLike += (humidity / 100) * (tempC - 20) * 0.5;
        } else if (tempC < 10) {
            // Wind chill adjustment
            feelsLike -= windSpeed * 0.3;
        }

        if (isShaded && tempC > 25) {
            feelsLike -= 3.0; // Shade relief
        }

        // Return a comfort score from 0 (miserable) to 100 (perfect)
        // Optimal is around 20-24C
        const deviation = Math.abs(feelsLike - 22);
        return Math.max(0, 100 - (deviation * 4));
    }

    private getDayOfYear(date: Date): number {
        const start = new Date(date.getFullYear(), 0, 0);
        const diff = date.getTime() - start.getTime();
        const oneDay = 1000 * 60 * 60 * 24;
        return Math.floor(diff / oneDay);
    }

    private toRadians(deg: number): number {
        return deg * (Math.PI / 180);
    }

    private toDegrees(rad: number): number {
        return rad * (180 / Math.PI);
    }
}
