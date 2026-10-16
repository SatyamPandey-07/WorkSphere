/**
 * VoxelOctree.ts
 * Manages the hierarchical octree data structure required for 
 * efficient storage and querying of large venue point clouds.
 */

export interface Point3D {
    x: number;
    y: number;
    z: number;
}

export interface OctreeNode {
    bounds: { min: number[]; max: number[] };
    points: Point3D[];
    children: (OctreeNode | null)[];
    isLeaf: boolean;
}

export class VoxelOctree {
    private root: OctreeNode;
    private maxDepth: number;
    private maxPointsPerNode: number;
    private nodeCount: number = 1;

    constructor(minBound: number[], maxBound: number[], maxDepth: number = 8, maxPointsPerNode: number = 64) {
        this.maxDepth = maxDepth;
        this.maxPointsPerNode = maxPointsPerNode;
        this.root = this.createNode(minBound, maxBound);
    }

    private createNode(min: number[], max: number[]): OctreeNode {
        return {
            bounds: { min, max },
            points: [],
            children: [null, null, null, null, null, null, null, null],
            isLeaf: true
        };
    }

    public insert(point: Point3D): void {
        this.insertRecursive(this.root, point, 0);
    }

    private insertRecursive(node: OctreeNode, point: Point3D, depth: number): void {
        if (!this.isPointInBounds(point, node.bounds)) return;

        if (node.isLeaf) {
            node.points.push(point);

            if (node.points.length > this.maxPointsPerNode && depth < this.maxDepth) {
                this.subdivide(node, depth);
            }
        } else {
            const childIndex = this.getChildIndex(node, point);
            if (node.children[childIndex]) {
                this.insertRecursive(node.children[childIndex]!, point, depth + 1);
            }
        }
    }

    private subdivide(node: OctreeNode, depth: number): void {
        const { min, max } = node.bounds;
        const mid = [
            (min[0] + max[0]) / 2,
            (min[1] + max[1]) / 2,
            (min[2] + max[2]) / 2
        ];

        // Create 8 octants
        const octants = [
            [min, mid],
            [[mid[0], min[1], min[2]], [max[0], mid[1], mid[2]]],
            [[min[0], mid[1], min[2]], [mid[0], max[1], mid[2]]],
            [[mid[0], mid[1], min[2]], [max[0], max[1], mid[2]]],
            [[min[0], min[1], mid[2]], [mid[0], mid[1], max[2]]],
            [[mid[0], min[1], mid[2]], [max[0], mid[1], max[2]]],
            [[min[0], mid[1], mid[2]], [mid[0], max[1], max[2]]],
            [mid, max]
        ];

        for (let i = 0; i < 8; i++) {
            node.children[i] = this.createNode(octants[i][0], octants[i][1]);
            this.nodeCount++;
        }

        node.isLeaf = false;

        // Redistribute existing points
        const existingPoints = node.points;
        node.points = [];

        for (const p of existingPoints) {
            const idx = this.getChildIndex(node, p);
            this.insertRecursive(node.children[idx]!, p, depth + 1);
        }
    }

    private getChildIndex(node: OctreeNode, point: Point3D): number {
        const { min, max } = node.bounds;
        const mid = [
            (min[0] + max[0]) / 2,
            (min[1] + max[1]) / 2,
            (min[2] + max[2]) / 2
        ];

        let index = 0;
        if (point.x > mid[0]) index |= 1;
        if (point.y > mid[1]) index |= 2;
        if (point.z > mid[2]) index |= 4;

        return index;
    }

    private isPointInBounds(point: Point3D, bounds: { min: number[], max: number[] }): boolean {
        return point.x >= bounds.min[0] && point.x <= bounds.max[0] &&
            point.y >= bounds.min[1] && point.y <= bounds.max[1] &&
            point.z >= bounds.min[2] && point.z <= bounds.max[2];
    }

    public queryRadius(center: number[], radius: number): Point3D[] {
        const results: Point3D[] = [];
        this.queryRadiusRecursive(this.root, center, radius * radius, results);
        return results;
    }

    private queryRadiusRecursive(node: OctreeNode, center: number[], radiusSq: number, results: Point3D[]): void {
        if (!this.sphereIntersectsBox(center, radiusSq, node.bounds)) return;

        if (node.isLeaf) {
            for (const p of node.points) {
                const dx = p.x - center[0];
                const dy = p.y - center[1];
                const dz = p.z - center[2];
                if (dx * dx + dy * dy + dz * dz <= radiusSq) {
                    results.push(p);
                }
            }
        } else {
            for (const child of node.children) {
                if (child) {
                    this.queryRadiusRecursive(child, center, radiusSq, results);
                }
            }
        }
    }

    private sphereIntersectsBox(center: number[], radiusSq: number, bounds: { min: number[], max: number[] }): boolean {
        let dmin = 0;
        for (let i = 0; i < 3; i++) {
            if (center[i] < bounds.min[i]) dmin += (center[i] - bounds.min[i]) ** 2;
            else if (center[i] > bounds.max[i]) dmin += (center[i] - bounds.max[i]) ** 2;
        }
        return dmin <= radiusSq;
    }

    public getNodeCount(): number {
        return this.nodeCount;
    }
}
