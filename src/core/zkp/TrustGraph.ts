/**
 * TrustGraph.ts
 * Manages the directed graph of user trust relationships and calculates the shortest path for trust verification.
 * Used to determine if a user is "trusted" by verifying a path of vouches from a known trusted entity.
 */

export interface TrustEdge {
    fromUserId: string;
    toUserId: string;
    trustWeight: number; // 1 to 10
    timestamp: number;
}

export class TrustGraph {
    private adjacencyList: Map<string, TrustEdge[]>;

    constructor() {
        this.adjacencyList = new Map();
    }

    /**
     * Adds a directed trust edge to the graph.
     */
    public addTrust(fromUserId: string, toUserId: string, weight: number): void {
        if (!this.adjacencyList.has(fromUserId)) {
            this.adjacencyList.set(fromUserId, []);
        }

        const edges = this.adjacencyList.get(fromUserId)!;
        edges.push({ fromUserId, toUserId, trustWeight: weight, timestamp: Date.now() });
    }

    /**
     * Finds the shortest path of trust from a trusted source to the target user.
     * Uses Breadth-First Search (BFS) to find the minimum number of hops.
     */
    public findShortestTrustPath(sourceId: string, targetId: string): string[] | null {
        if (sourceId === targetId) return [sourceId];

        const queue: { userId: string; path: string[] }[] = [{ userId: sourceId, path: [sourceId] }];
        const visited = new Set<string>();
        visited.add(sourceId);

        while (queue.length > 0) {
            const { userId, path } = queue.shift()!;

            const edges = this.adjacencyList.get(userId) || [];
            for (const edge of edges) {
                if (edge.toUserId === targetId) {
                    return [...path, targetId];
                }

                if (!visited.has(edge.toUserId)) {
                    visited.add(edge.toUserId);
                    queue.push({ userId: edge.toUserId, path: [...path, edge.toUserId] });
                }
            }
        }

        return null; // No path found
    }

    /**
     * Calculates the aggregate trust score for a user based on incoming edges.
     */
    public calculateTrustScore(userId: string): number {
        let totalScore = 0;
        let edgeCount = 0;

        for (const edges of this.adjacencyList.values()) {
            for (const edge of edges) {
                if (edge.toUserId === userId) {
                    totalScore += edge.trustWeight;
                    edgeCount++;
                }
            }
        }

        return edgeCount > 0 ? totalScore / edgeCount : 0;
    }

    /**
     * Exports the graph data for circuit input generation.
     */
    public exportForCircuit(userId: string): { vouchCount: number; minTrustWeight: number } {
        let vouchCount = 0;
        let minTrustWeight = 10;

        for (const edges of this.adjacencyList.values()) {
            for (const edge of edges) {
                if (edge.toUserId === userId) {
                    vouchCount++;
                    if (edge.trustWeight < minTrustWeight) {
                        minTrustWeight = edge.trustWeight;
                    }
                }
            }
        }

        return { vouchCount, minTrustWeight };
    }
}
