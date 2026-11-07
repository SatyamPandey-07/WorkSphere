/**
 * GlarePredictionEngine
 * Performs simplified 3D ray-casting against the venue's window polygons to determine 
 * which desk bounding boxes intersect with solar vectors.
 */

import { SolarPosition } from './SunTrajectoryCalculator';

export interface Vector3 {
    x: number;
    y: number;
    z: number;
}

export interface DeskBoundingBox {
    deskId: string;
    center: Vector3;
    width: number;
    depth: number;
    height: number;
}

export interface WindowPolygon {
    windowId: string;
    vertices: Vector3[]; // Assumed to be planar and convex
    normal: Vector3;
}

export interface GlareResult {
    deskId: string;
    timestamp: number;
    hasGlare: boolean;
    intensity: number; // 0.0 to 1.0
}

export class GlarePredictionEngine {

    public predictGlare(
        desks: DeskBoundingBox[],
        windows: WindowPolygon[],
        sunPosition: SolarPosition
    ): GlareResult[] {
        const results: GlareResult[] = [];

        // Convert solar azimuth/elevation to a 3D direction vector
        const sunVector = this.solarToVector(sunPosition.azimuth, sunPosition.elevation);

        for (const desk of desks) {
            let maxIntensity = 0;
            let hasGlare = false;

            for (const window of windows) {
                // Check if sun is shining THROUGH the window (dot product with normal)
                const dot = this.dotProduct(sunVector, window.normal);

                // If dot > 0, sun is hitting the outside of the window. 
                // We want sun coming IN, so we check if the ray from desk to sun intersects the window plane.
                // Simplified: If sun elevation > 0 and azimuth aligns with window facing direction

                const rayOrigin = desk.center;
                // Ray direction is OPPOSITE of sun vector (casting ray from desk towards sun)
                const rayDir = { x: -sunVector.x, y: -sunVector.y, z: -sunVector.z };

                const intersection = this.rayIntersectsPolygon(rayOrigin, rayDir, window);

                if (intersection) {
                    hasGlare = true;
                    // Intensity based on sun elevation (lower sun = more direct glare on vertical screens)
                    const elevationFactor = Math.cos(this.toRadians(sunPosition.elevation));
                    const intensity = Math.min(1.0, elevationFactor * 1.5);
                    maxIntensity = Math.max(maxIntensity, intensity);
                }
            }

            results.push({
                deskId: desk.deskId,
                timestamp: sunPosition.timestamp,
                hasGlare,
                intensity: maxIntensity
            });
        }

        return results;
    }

    private solarToVector(azimuth: number, elevation: number): Vector3 {
        const azRad = this.toRadians(azimuth);
        const elRad = this.toRadians(elevation);

        return {
            x: Math.sin(azRad) * Math.cos(elRad),
            y: Math.cos(azRad) * Math.cos(elRad), // Assuming Y is North
            z: Math.sin(elRad) // Z is Up
        };
    }

    private rayIntersectsPolygon(origin: Vector3, dir: Vector3, polygon: WindowPolygon): boolean {
        // Simplified Möller–Trumbore intersection algorithm for a planar polygon
        // 1. Find intersection with the plane defined by the polygon
        const denom = this.dotProduct(polygon.normal, dir);
        if (Math.abs(denom) < 1e-6) return false; // Ray is parallel to plane

        const v0 = polygon.vertices[0];
        const t = this.dotProduct({
            x: v0.x - origin.x,
            y: v0.y - origin.y,
            z: v0.z - origin.z
        }, polygon.normal) / denom;

        if (t < 0) return false; // Intersection is behind the ray origin

        const intersectionPoint: Vector3 = {
            x: origin.x + t * dir.x,
            y: origin.y + t * dir.y,
            z: origin.z + t * dir.z
        };

        // 2. Check if point is inside the polygon (simplified bounding box check for performance)
        return this.isPointInPolygonBounds(intersectionPoint, polygon.vertices);
    }

    private isPointInPolygonBounds(point: Vector3, vertices: Vector3[]): boolean {
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;

        for (const v of vertices) {
            minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
            minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
            minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
        }

        // Add small tolerance
        const tol = 0.1;
        return point.x >= minX - tol && point.x <= maxX + tol &&
            point.y >= minY - tol && point.y <= maxY + tol &&
            point.z >= minZ - tol && point.z <= maxZ + tol;
    }

    private dotProduct(a: Vector3, b: Vector3): number {
        return a.x * b.x + a.y * b.y + a.z * b.z;
    }

    private toRadians(degrees: number): number {
        return degrees * (Math.PI / 180);
    }
}