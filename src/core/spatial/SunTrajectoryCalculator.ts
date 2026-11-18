/**
 * SunTrajectoryCalculator
 * Computes the precise azimuth and elevation angles of the sun based on the venue's 
 * geolocation and current timestamp using simplified astronomical algorithms.
 */

export interface GeoLocation {
    latitude: number;
    longitude: number;
}

export interface SolarPosition {
    azimuth: number; // Degrees from North (0-360)
    elevation: number; // Degrees above horizon (-90 to 90)
    timestamp: number;
}

export class SunTrajectoryCalculator {
    /**
     * Calculates solar position using a simplified SPA (Solar Position Algorithm)
     */
    public calculate(location: GeoLocation, date: Date): SolarPosition {
        const dayOfYear = this.getDayOfYear(date);
        const solarTime = this.getSolarTime(date, location.longitude);

        // Solar Declination (approximate)
        const declination = 23.45 * Math.sin(this.toRadians((360 / 365) * (dayOfYear - 81)));

        // Hour Angle
        const hourAngle = 15 * (solarTime - 12);

        // Elevation Angle
        const latRad = this.toRadians(location.latitude);
        const decRad = this.toRadians(declination);
        const haRad = this.toRadians(hourAngle);

        const sinElevation = Math.sin(latRad) * Math.sin(decRad) +
            Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);
        const elevation = this.toDegrees(Math.asin(sinElevation));

        // Azimuth Angle
        const cosAzimuth = (Math.sin(decRad) - Math.sin(latRad) * sinElevation) /
            (Math.cos(latRad) * Math.cos(this.toRadians(elevation)));

        let azimuth = this.toDegrees(Math.acos(Math.max(-1, Math.min(1, cosAzimuth))));

        if (hourAngle > 0) {
            azimuth = 360 - azimuth;
        }

        return {
            azimuth,
            elevation,
            timestamp: date.getTime()
        };
    }

    public getTrajectory(location: GeoLocation, date: Date, intervalMinutes: number = 30): SolarPosition[] {
        const trajectory: SolarPosition[] = [];
        const start = new Date(date);
        start.setHours(0, 0, 0, 0);

        for (let i = 0; i < 24 * 60; i += intervalMinutes) {
            const current = new Date(start.getTime() + i * 60000);
            const pos = this.calculate(location, current);

            // Only include times when sun is above horizon
            if (pos.elevation > 0) {
                trajectory.push(pos);
            }
        }

        return trajectory;
    }

    private getDayOfYear(date: Date): number {
        const start = new Date(date.getFullYear(), 0, 0);
        const diff = date.getTime() - start.getTime();
        const oneDay = 1000 * 60 * 60 * 24;
        return Math.floor(diff / oneDay);
    }

    private getSolarTime(date: Date, longitude: number): number {
        // Simplified solar time calculation ignoring equation of time for performance
        const timezoneOffset = date.getTimezoneOffset() / -60;
        const standardMeridian = timezoneOffset * 15;
        const longitudeCorrection = (longitude - standardMeridian) * 4; // 4 minutes per degree

        const hours = date.getHours() + (date.getMinutes() / 60) + (date.getSeconds() / 3600);
        return hours + (longitudeCorrection / 60);
    }

    private toRadians(degrees: number): number {
        return degrees * (Math.PI / 180);
    }

    private toDegrees(radians: number): number {
        return radians * (180 / Math.PI);
    }
}
