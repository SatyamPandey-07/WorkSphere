/**
 * ItineraryGraph.ts
 * Defines the venue node graph and edge weighting logic for multi-venue itinerary optimization.
 * Handles the construction of a directed graph where nodes are venues and edges are transit paths.
 */

export interface VenueNode {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    openingHours: string; // e.g., "Mo-Fr 08:00-18:00" or "24/7"
    averageDwellTimeMinutes: number;
    timezone: string;
}

export interface TransitEdge {
    fromVenueId: string;
    toVenueId: string;
    transitTimeMinutes: number;
    distanceMeters: number;
    mode: 'walking' | 'cycling' | 'train' | 'rideshare' | 'driving';
    co2GramsPerKm?: number;
    cost?: number;
}

export class ItineraryGraph {
    private nodes: Map<string, VenueNode>;
    private edges: Map<string, TransitEdge>;

    constructor() {
        this.nodes = new Map();
        this.edges = new Map();
    }

    public addNode(node: VenueNode): void {
        if (this.nodes.has(node.id)) {
            throw new Error(`Venue node with id ${node.id} already exists in the graph.`);
        }
        this.nodes.set(node.id, node);
    }

    public addEdge(edge: TransitEdge): void {
        if (!this.nodes.has(edge.fromVenueId) || !this.nodes.has(edge.toVenueId)) {
            throw new Error(`Cannot add edge: one or both venue IDs do not exist in the graph.`);
        }
        const edgeKey = this.getEdgeKey(edge.fromVenueId, edge.toVenueId);
        this.edges.set(edgeKey, edge);
    }

    public getNode(id: string): VenueNode | undefined {
        return this.nodes.get(id);
    }

    public getEdge(fromId: string, toId: string): TransitEdge | undefined {
        return this.edges.get(this.getEdgeKey(fromId, toId));
    }

    public getAllNodes(): VenueNode[] {
        return Array.from(this.nodes.values());
    }

    public getAllEdges(): TransitEdge[] {
        return Array.from(this.edges.values());
    }

    private getEdgeKey(fromId: string, toId: string): string {
        return `${fromId}::${toId}`;
    }

    public calculateTotalTransitTime(sequence: string[]): number {
        let totalTime = 0;
        for (let i = 0; i < sequence.length - 1; i++) {
            const edge = this.getEdge(sequence[i], sequence[i + 1]);
            if (edge) {
                totalTime += edge.transitTimeMinutes;
            } else {
                throw new Error(`Missing transit edge between ${sequence[i]} and ${sequence[i + 1]}`);
            }
        }
        return totalTime;
    }

    public calculateTotalDwellTime(sequence: string[]): number {
        let totalDwell = 0;
        for (const nodeId of sequence) {
            const node = this.getNode(nodeId);
            if (node) {
                totalDwell += node.averageDwellTimeMinutes;
            }
        }
        return totalDwell;
    }

    public clear(): void {
        this.nodes.clear();
        this.edges.clear();
    }
}
