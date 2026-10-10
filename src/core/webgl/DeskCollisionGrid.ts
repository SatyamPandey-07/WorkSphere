/**
 * DeskCollisionGrid.ts
 * Implements a spatial hash grid to perform O(1) collision detection for desk placement and user movement.
 * Prevents overlapping virtual assets or invalid booking selections in the isometric view.
 */

export interface GridCell {
    instances: string[]; // Array of desk IDs
}

export class DeskCollisionGrid {
    private cellSize: number;
    private grid: Map<string, GridCell>;

    constructor(cellSize: number = 2.0) {
        this.cellSize = cellSize;
        this.grid = new Map();
    }

    private getCellKey(x: number, y: number): string {
        const gridX = Math.floor(x / this.cellSize);
        const gridY = Math.floor(y / this.cellSize);
        return `${gridX},${gridY}`;
    }

    public insert(deskId: string, x: number, y: number, width: number, height: number): void {
        const minX = Math.floor((x - width / 2) / this.cellSize);
        const maxX = Math.floor((x + width / 2) / this.cellSize);
        const minY = Math.floor((y - height / 2) / this.cellSize);
        const maxY = Math.floor((y + height / 2) / this.cellSize);

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
        const minX = Math.floor((x - width / 2) / this.cellSize);
        const maxX = Math.floor((x + width / 2) / this.cellSize);
        const minY = Math.floor((y - height / 2) / this.cellSize);
        const maxY = Math.floor((y + height / 2) / this.cellSize);

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

    public query(x: number, y: number, radius: number): string[] {
        const minCX = Math.floor((x - radius) / this.cellSize);
        const maxCX = Math.floor((x + radius) / this.cellSize);
        const minCY = Math.floor((y - radius) / this.cellSize);
        const maxCY = Math.floor((y + radius) / this.cellSize);

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

    public clear(): void {
        this.grid.clear();
    }
}
