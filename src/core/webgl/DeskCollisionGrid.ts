/**
 * DeskCollisionGrid.ts
 * Implements a spatial hash grid to perform O(1) collision detection for desk placement and user movement.
 * Prevents overlapping virtual assets or invalid booking selections in the isometric view.
 * Guards against out-of-bounds coordinates outside the venue bounding box (#5604).
 */

export interface GridCell {
    instances: string[]; // Array of desk IDs
}

export class DeskCollisionGrid {
    private cellSize: number;
    private width: number;
    private height: number;
    private grid: Map<string, GridCell>;

    constructor(cellSize: number = 2.0, width: number = 100, height: number = 100) {
        this.cellSize = cellSize;
        this.width = width;
        this.height = height;
        this.grid = new Map();
    }

    /**
     * Checks if coordinates fall outside the venue bounding box:
     * x < 0 || x >= width || y < 0 || y >= height
     */
    public isOutOfBounds(x: number, y: number): boolean {
        return x < 0 || x >= this.width || y < 0 || y >= this.height;
    }

    public getWidth(): number {
        return this.width;
    }

    public getHeight(): number {
        return this.height;
    }

    public getCellSize(): number {
        return this.cellSize;
    }

    private getCellKey(x: number, y: number): string | null {
        // Boundary check before computing grid cell index (#5604)
        if (this.isOutOfBounds(x, y)) {
            return null;
        }
        const gridX = Math.floor(x / this.cellSize);
        const gridY = Math.floor(y / this.cellSize);
        return `${gridX},${gridY}`;
    }

    public insert(deskId: string, x: number, y: number, width: number, height: number): void {
        const startX = x - width / 2;
        const endX = x + width / 2;
        const startY = y - height / 2;
        const endY = y + height / 2;

        // If completely outside venue bounding box, drop insertion
        if (endX < 0 || startX >= this.width || endY < 0 || startY >= this.height) {
            return;
        }

        const minX = Math.max(0, Math.floor(Math.max(0, startX) / this.cellSize));
        const maxX = Math.min(
            Math.floor((this.width - 1) / this.cellSize),
            Math.floor(Math.min(this.width - 1, endX) / this.cellSize)
        );
        const minY = Math.max(0, Math.floor(Math.max(0, startY) / this.cellSize));
        const maxY = Math.min(
            Math.floor((this.height - 1) / this.cellSize),
            Math.floor(Math.min(this.height - 1, endY) / this.cellSize)
        );

        for (let cx = minX; cx <= maxX; cx++) {
            for (let cy = minY; cy <= maxY; cy++) {
                const key = `${cx},${cy}`;
                if (!this.grid.has(key)) {
                    this.grid.set(key, { instances: [] });
                }
                const cell = this.grid.get(key)!;
                if (!cell.instances.includes(deskId)) {
                    cell.instances.push(deskId);
                }
            }
        }
    }

    public remove(deskId: string, x: number, y: number, width: number, height: number): void {
        const startX = x - width / 2;
        const endX = x + width / 2;
        const startY = y - height / 2;
        const endY = y + height / 2;

        if (endX < 0 || startX >= this.width || endY < 0 || startY >= this.height) {
            return;
        }

        const minX = Math.max(0, Math.floor(Math.max(0, startX) / this.cellSize));
        const maxX = Math.min(
            Math.floor((this.width - 1) / this.cellSize),
            Math.floor(Math.min(this.width - 1, endX) / this.cellSize)
        );
        const minY = Math.max(0, Math.floor(Math.max(0, startY) / this.cellSize));
        const maxY = Math.min(
            Math.floor((this.height - 1) / this.cellSize),
            Math.floor(Math.min(this.height - 1, endY) / this.cellSize)
        );

        for (let cx = minX; cx <= maxX; cx++) {
            for (let cy = minY; cy <= maxY; cy++) {
                const key = `${cx},${cy}`;
                const cell = this.grid.get(key);
                if (cell) {
                    cell.instances = cell.instances.filter(id => id !== deskId);
                    if (cell.instances.length === 0) {
                        this.grid.delete(key);
                    }
                }
            }
        }
    }

    /**
     * Queries for desk instances within radius of coordinates.
     * Returns an empty array for out-of-bounds queries (#5604).
     */
    public query(x: number, y: number, radius: number = 0): string[] {
        // Return empty collision response for out-of-bounds coordinates (#5604)
        if (this.isOutOfBounds(x, y)) {
            return [];
        }

        const minCX = Math.max(0, Math.floor(Math.max(0, x - radius) / this.cellSize));
        const maxCX = Math.min(
            Math.floor((this.width - 1) / this.cellSize),
            Math.floor(Math.min(this.width - 1, x + radius) / this.cellSize)
        );
        const minCY = Math.max(0, Math.floor(Math.max(0, y - radius) / this.cellSize));
        const maxCY = Math.min(
            Math.floor((this.height - 1) / this.cellSize),
            Math.floor(Math.min(this.height - 1, y + radius) / this.cellSize)
        );

        const results = new Set<string>();

        for (let cx = minCX; cx <= maxCX; cx++) {
            for (let cy = minCY; cy <= maxCY; cy++) {
                const cell = this.grid.get(`${cx},${cy}`);
                if (cell) {
                    for (const id of cell.instances) {
                        results.add(id);
                    }
                }
            }
        }

        return Array.from(results);
    }

    /**
     * Checks if coordinates collide with any registered desk.
     * Returns false for out-of-bounds coordinates (#5604).
     */
    public checkCollision(x: number, y: number, radius: number = 0): boolean {
        if (this.isOutOfBounds(x, y)) {
            return false;
        }
        const hits = this.query(x, y, radius);
        return hits.length > 0;
    }

    /**
     * Retrieves the desk ID at the specified coordinates, or null if empty or out of bounds (#5604).
     */
    public getDeskAt(x: number, y: number): string | null {
        if (this.isOutOfBounds(x, y)) {
            return null;
        }
        const key = this.getCellKey(x, y);
        if (!key) return null;
        const cell = this.grid.get(key);
        return cell && cell.instances.length > 0 ? cell.instances[0] : null;
    }

    public clear(): void {
        this.grid.clear();
    }
}
