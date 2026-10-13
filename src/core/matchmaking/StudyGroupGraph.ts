/**
 * StudyGroupGraph
 * Manages the directed graph of potential collaborations and tracks mutual opt-in states.
 */

export interface GraphNode {
    userId: string;
    interests: string[];
    currentGroup?: string;
}

export interface GraphEdge {
    source: string;
    target: string;
    weight: number; // Similarity score
    mutual: boolean; // Both users opted in
    timestamp: number;
}

export class StudyGroupGraph {
    private nodes: Map<string, GraphNode>;
    private adjacencyList: Map<string, Map<string, GraphEdge>>;

    constructor() {
        this.nodes = new Map();
        this.adjacencyList = new Map();
    }

    public addUser(userId: string, interests: string[]): void {
        this.nodes.set(userId, { userId, interests });
        if (!this.adjacencyList.has(userId)) {
            this.adjacencyList.set(userId, new Map());
        }
    }

    public addEdge(source: string, target: string, weight: number): void {
        if (!this.adjacencyList.has(source)) this.addUser(source, []);
        if (!this.adjacencyList.has(target)) this.addUser(target, []);

        const existing = this.adjacencyList.get(source)?.get(target);
        const isMutual = existing ? true : false; // Simplified mutual logic

        this.adjacencyList.get(source)?.set(target, {
            source,
            target,
            weight,
            mutual: isMutual,
            timestamp: Date.now()
        });
    }

    public confirmOptIn(userIdA: string, userIdB: string): void {
        const edgeAB = this.adjacencyList.get(userIdA)?.get(userIdB);
        const edgeBA = this.adjacencyList.get(userIdB)?.get(userIdA);

        if (edgeAB) edgeAB.mutual = true;
        if (edgeBA) edgeBA.mutual = true;
    }

    /**
     * Detects cliques (fully connected subgraphs) of mutual opt-ins.
     * Simplified community detection for group provisioning.
     */
    public detectGroups(minSize: number = 2): string[][] {
        const groups: string[][] = [];
        const visited = new Set<string>();

        for (const node of this.nodes.keys()) {
            if (visited.has(node)) continue;

            const mutualConnections = Array.from(this.adjacencyList.get(node)?.values() || [])
                .filter(e => e.mutual)
                .map(e => e.target);

            if (mutualConnections.length >= minSize - 1) {
                // Check if all connections are mutually connected to each other
                const isClique = mutualConnections.every(conn => {
                    const connEdges = this.adjacencyList.get(conn);
                    return mutualConnections.every(otherConn =>
                        conn === otherConn || connEdges?.has(otherConn)
                    );
                });

                if (isClique) {
                    const group = [node, ...mutualConnections];
                    groups.push(group);
                    group.forEach(id => visited.add(id));
                }
            }
        }

        return groups;
    }

    public getGraphStats(): { nodes: number; edges: number; mutualEdges: number } {
        let edgeCount = 0;
        let mutualCount = 0;

        for (const edges of this.adjacencyList.values()) {
            edgeCount += edges.size;
            for (const edge of edges.values()) {
                if (edge.mutual) mutualCount++;
            }
        }

        return {
            nodes: this.nodes.size,
            edges: edgeCount,
            mutualEdges: mutualCount / 2 // Count each mutual pair once
        };
    }
}
