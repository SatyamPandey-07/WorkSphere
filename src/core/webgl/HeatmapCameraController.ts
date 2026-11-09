/**
 * HeatmapCameraController.ts
 * Handles the 3D-to-2D matrix projections to ensure the heatmap aligns with the 2D Leaflet map.
 * Computes the orthographic projection matrix based on map zoom and center.
 */

export class HeatmapCameraController {
    private zoom: number;
    private center: [number, number];
    private activeFloor: string | number | null = null;

    constructor(initialZoom: number = 13, initialCenter: [number, number] = [0, 0], initialFloor?: string | number) {
        this.zoom = initialZoom;
        this.center = initialCenter;
        this.activeFloor = initialFloor ?? null;
    }

    public update(zoom: number, center: [number, number]): void {
        this.zoom = zoom;
        this.center = center;
    }

    public setFloor(floor: string | number): void {
        this.activeFloor = floor;
    }

    public getFloor(): string | number | null {
        return this.activeFloor;
    }

    public reset(): void {
        this.zoom = 13;
        this.center = [0, 0];
        this.activeFloor = null;
    }

    public onContextLost(): void {
        // Retain projection parameters while pausing active matrix recalculations
    }

    public onContextRestored(): void {
        // Re-validate or re-synchronize projection matrix state after context restoration
    }

    public dispose(): void {
        this.reset();
    }

    /**
     * Generates a 3x3 projection matrix for WebGL.
     * This matrix scales and translates the normalized heatmap coordinates to match the Leaflet map viewport.
     */
    public getProjectionMatrix(): Float32Array {
        // Simplified orthographic projection for 2D map overlay
        // Scale factor based on zoom level (higher zoom = smaller scale)
        const scale = Math.pow(2, 13 - this.zoom);

        // Translation based on center offset
        const tx = -this.center[0] * scale;
        const ty = -this.center[1] * scale;

        return new Float32Array([
            scale, 0.0, 0.0,
            0.0, scale, 0.0,
            tx, ty, 1.0
        ]);
    }

    /**
     * Converts LatLng coordinates to WebGL normalized device coordinates (NDC).
     */
    public latLngToNDC(lat: number, lng: number, bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }): [number, number] {
        const normX = (lng - bounds.minLng) / (bounds.maxLng - bounds.minLng);
        const normY = (lat - bounds.minLat) / (bounds.maxLat - bounds.minLat);

        // Convert to NDC (-1 to 1)
        return [
            normX * 2 - 1,
            -(normY * 2 - 1) // Invert Y for WebGL
        ];
    }
}
