/**
 * GradientCalculator.ts
 * Ingests Digital Elevation Model (DEM) data to calculate the exact slope percentage of pathways and ramps.
 * Critical for wheelchair users who cannot navigate gradients exceeding 8.33% (1:12 ratio).
 */

export interface DEMPoint {
    latitude: number;
    longitude: number;
    elevationMeters: number;
}

export class GradientCalculator {
    private readonly MAX_WHEELCHAIR_GRADIENT = 8.33;

    public calculateGradient(start: DEMPoint, end: DEMPoint): { gradientPercent: number; isAccessible: boolean } {
        const horizontalDistance = this.calculateHaversineDistance(
            start.latitude, start.longitude,
            end.latitude, end.longitude
        );

        if (horizontalDistance === 0) {
            return { gradientPercent: 0, isAccessible: true };
        }

        const elevationChange = Math.abs(end.elevationMeters - start.elevationMeters);
        const gradientPercent = (elevationChange / horizontalDistance) * 100;

        return {
            gradientPercent,
            isAccessible: gradientPercent <= this.MAX_WHEELCHAIR_GRADIENT
        };
    }

    public interpolateElevation(points: DEMPoint[], targetLat: number, targetLng: number): number {
        if (points.length === 0) return 0;
        if (points.length === 1) return points[0].elevationMeters;

        let totalWeight = 0;
        let weightedElevation = 0;

        for (const point of points) {
            const distance = this.calculateHaversineDistance(
                targetLat, targetLng,
                point.latitude, point.longitude
            );

            const weight = 1 / (distance * distance + 0.0001);
            totalWeight += weight;
            weightedElevation += point.elevationMeters * weight;
        }

        return weightedElevation / totalWeight;
    }

    private calculateHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const R = 6371000;
        const dLat = (lat2 - lat1) * (Math.PI / 180);
        const dLon = (lon2 - lon1) * (Math.PI / 180);
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }
}
