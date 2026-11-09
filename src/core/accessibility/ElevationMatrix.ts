/**
 * ElevationMatrix.ts
 * Processes Digital Elevation Model (DEM) data to calculate precise path inclines and penalize steep routes.
 */

export interface Coordinate {
    lat: number;
    lng: number;
}

export interface ElevationProfile {
    coordinates: Coordinate[];
    elevations: number[]; // in meters
    maxGrade: number;     // maximum slope percentage
    averageGrade: number; // average slope percentage
}

export class ElevationMatrix {
    private static readonly MIN_SAFE_DISTANCE_METERS = 0.5;
    private static readonly MAX_SAFE_GRADE_PERCENT = 100.0;

    /**
     * Calculates the slope (grade) between two points given their distance and elevation difference.
     * Guards against division by zero and near-zero distances that cause numerical overflow.
     * @param elevationDiff Difference in elevation in meters.
     * @param distance Distance between points in meters.
     * @returns Grade as a percentage, safely clamped.
     */
    public calculateGrade(elevationDiff: number, distance: number): number {
        if (!Number.isFinite(elevationDiff) || !Number.isFinite(distance)) {
            return 0;
        }

        const absElevation = Math.abs(elevationDiff);
        const effectiveDistance = Math.max(distance, ElevationMatrix.MIN_SAFE_DISTANCE_METERS);

        if (distance <= 0 && absElevation === 0) {
            return 0;
        }

        const grade = (absElevation / effectiveDistance) * 100;
        return Math.min(grade, ElevationMatrix.MAX_SAFE_GRADE_PERCENT);
    }

    /**
     * Analyzes a route's elevation profile to determine accessibility compliance.
     * ADA guidelines generally recommend a maximum running slope of 8.33% (1:12).
     * @param elevations Array of elevation points in meters along the route.
     * @param distances Array of cumulative distances in meters corresponding to elevations.
     */
    public analyzeProfile(elevations: number[], distances: number[]): ElevationProfile {
        if (!Array.isArray(elevations) || !Array.isArray(distances) || elevations.length !== distances.length || elevations.length < 2) {
            throw new Error('Elevations and distances arrays must match and have at least 2 points.');
        }

        let maxGrade = 0;
        let totalElevationDiff = 0;
        const totalDistance = Math.max(0, distances[distances.length - 1] - distances[0]);

        for (let i = 1; i < elevations.length; i++) {
            const elevDiff = Math.abs(elevations[i] - elevations[i - 1]);
            const distDiff = Math.max(0, distances[i] - distances[i - 1]);

            if (distDiff > 0) {
                const grade = this.calculateGrade(elevDiff, distDiff);
                if (grade > maxGrade) {
                    maxGrade = grade;
                }
                totalElevationDiff += elevDiff;
            }
        }

        const averageGrade = totalDistance > 0 ? Math.min(100, (totalElevationDiff / totalDistance) * 100) : 0;

        return {
            coordinates: [], // Populated by caller if needed
            elevations,
            maxGrade: Number.isFinite(maxGrade) ? maxGrade : ElevationMatrix.MAX_SAFE_GRADE_PERCENT,
            averageGrade: Number.isFinite(averageGrade) ? averageGrade : 0
        };
    }

    /**
     * Determines if a route is wheelchair accessible based on max grade threshold.
     * @param profile The analyzed elevation profile.
     * @param maxAllowedGrade Default 8.33% (ADA standard).
     */
    public isWheelchairAccessible(profile: ElevationProfile, maxAllowedGrade: number = 8.33): boolean {
        if (!profile || !Number.isFinite(profile.maxGrade)) return false;
        return profile.maxGrade <= maxAllowedGrade;
    }
}

