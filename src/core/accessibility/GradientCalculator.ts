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

export interface DirectionVector {
    x: number;
    y: number;
}

export class GradientCalculator {
    private readonly MAX_WHEELCHAIR_GRADIENT = 8.33;

    public calculateGradient(
        start: DEMPoint,
        end: DEMPoint,
        traversalHeading?: DirectionVector
    ): { gradientPercent: number; isAccessible: boolean } {
        const horizontalDistance = this.calculateHaversineDistance(
            start.latitude, start.longitude,
            end.latitude, end.longitude
        );

        const elevationChange = end.elevationMeters - start.elevationMeters;
        let distanceAlongPath = horizontalDistance;

        if (traversalHeading) {
            const headingMagnitude = Math.hypot(traversalHeading.x, traversalHeading.y);
            if (!Number.isFinite(headingMagnitude) || headingMagnitude === 0) {
                throw new RangeError('Traversal heading must be a finite, non-zero vector.');
            }

            const latitudeRadians = ((start.latitude + end.latitude) / 2) * (Math.PI / 180);
            const eastwardDistance =
                (end.longitude - start.longitude) * (Math.PI / 180) * 6371000 * Math.cos(latitudeRadians);
            const northwardDistance =
                (end.latitude - start.latitude) * (Math.PI / 180) * 6371000;
            const headingX = traversalHeading.x / headingMagnitude;
            const headingY = traversalHeading.y / headingMagnitude;

            distanceAlongPath = eastwardDistance * headingX + northwardDistance * headingY;
        }

        if (distanceAlongPath === 0) {
            const gradientPercent = elevationChange === 0 ? 0 : Infinity;
            return {
                gradientPercent,
                isAccessible: gradientPercent <= this.MAX_WHEELCHAIR_GRADIENT
            };
        }

        const signedGradientPercent = (elevationChange / distanceAlongPath) * 100;
        const gradientPercent = Math.abs(signedGradientPercent);

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
