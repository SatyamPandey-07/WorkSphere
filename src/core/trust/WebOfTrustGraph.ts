export interface TrustNode {
    userId: string;
    publicKey: string;
}

export interface TrustEdge {
    endorserId: string;
    endorseeId: string;
    skill: string;
    signature: string; // ECDSA signature
    timestamp: number;
}

/**
 * Manages the directed graph of user endorsements and implements 
 * the shortest-path algorithm for Trust Rank calculation.
 */
export class WebOfTrustGraph {
    private nodes: Map<string, TrustNode> = new Map();
    private edges: Map<string, TrustEdge[]> = new Map(); // endorseeId -> list of endorsements

    public addNode(node: TrustNode): void {
        this.nodes.set(node.userId, node);
        if (!this.edges.has(node.userId)) {
            this.edges.set(node.userId, []);
        }
    }

    public addEndorsement(edge: TrustEdge): void {
        if (!this.edges.has(edge.endorseeId)) {
            this.edges.set(edge.endorseeId, []);
        }
        this.edges.get(edge.endorseeId)!.push(edge);
    }

    /**
     * Calculates the "Trust Rank" for a specific user and skill.
     * Uses a BFS to find the shortest path to a known "Anchor" (verified identity).
     * Trust decays exponentially with distance.
     */
    public calculateTrustRank(targetUserId: string, skill: string, anchorIds: string[]): number {
        if (anchorIds.includes(targetUserId)) return 1.0;

        const queue: { userId: string; distance: number }[] = [{ userId: targetUserId, distance: 0 }];
        const visited = new Set<string>([targetUserId]);

        let minDistance = Infinity;

        while (queue.length > 0) {
            const current = queue.shift()!;

            const endorsements = this.edges.get(current.userId) || [];
            for (const edge of endorsements) {
                if (edge.skill !== skill) continue;

                if (anchorIds.includes(edge.endorserId)) {
                    minDistance = Math.min(minDistance, current.distance + 1);
                }

                if (!visited.has(edge.endorserId)) {
                    visited.add(edge.endorserId);
                    queue.push({ userId: edge.endorserId, distance: current.distance + 1 });
                }
            }
        }

        if (minDistance === Infinity) return 0;

        // Trust decay: 1.0 for anchor, 0.5 for distance 1, 0.25 for distance 2...
        return Math.pow(0.5, minDistance);
    }
}
