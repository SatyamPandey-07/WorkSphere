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

export type MobilityMode = 'walking' | 'cycling' | 'train' | 'rideshare' | 'driving';

export const DEFAULT_TRANSIT_SPEEDS_KMH: Record<MobilityMode, number> = {
    walking: 4.5,
    cycling: 15,
    train: 40,
    rideshare: 30,
    driving: 35,
};

export interface TransitEdge {
    fromVenueId: string;
    toVenueId: string;
    transitTimeMinutes: number;
    distanceMeters: number;
    mode: MobilityMode;
    co2GramsPerKm?: number;
    cost?: number;
}

export interface PriorityQueueItem<T> {
    element: T;
    priority: number;
    tieBreaker?: string | number;
}

/**
 * Deterministic Min-Priority Queue for branch-and-bound search.
 * Breaks ties predictably using tieBreaker or element identification.
 */
export class PriorityQueue<T> {
    private items: PriorityQueueItem<T>[] = [];

    public enqueue(element: T, priority: number, tieBreaker: string | number = ''): void {
        const item: PriorityQueueItem<T> = { element, priority, tieBreaker };
        let added = false;
        for (let i = 0; i < this.items.length; i++) {
            if (
                item.priority < this.items[i].priority ||
                (item.priority === this.items[i].priority && String(item.tieBreaker) < String(this.items[i].tieBreaker))
            ) {
                this.items.splice(i, 0, item);
                added = true;
                break;
            }
        }
        if (!added) {
            this.items.push(item);
        }
    }

    public dequeue(): T | undefined {
        return this.items.shift()?.element;
    }

    public peek(): PriorityQueueItem<T> | undefined {
        return this.items[0];
    }

    public isEmpty(): boolean {
        return this.items.length === 0;
    }

    public size(): number {
        return this.items.length;
    }

    public clear(): void {
        this.items = [];
    }
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

    public calculateDistanceMeters(fromVenueId: string, toVenueId: string): number {
        const edge = this.getEdge(fromVenueId, toVenueId);
        if (edge && edge.distanceMeters !== undefined) {
            return edge.distanceMeters;
        }
        const fromNode = this.getNode(fromVenueId);
        const toNode = this.getNode(toVenueId);
        if (!fromNode || !toNode) {
            return 0;
        }
        // Great-circle distance using Haversine formula
        const R = 6371e3; // Earth radius in meters
        const rad = Math.PI / 180;
        const lat1 = fromNode.latitude * rad;
        const lat2 = toNode.latitude * rad;
        const dLat = (toNode.latitude - fromNode.latitude) * rad;
        const dLon = (toNode.longitude - fromNode.longitude) * rad;

        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return Math.round(R * c);
    }

    public getRequiredTransitBufferMinutes(
        fromVenueId: string,
        toVenueId: string,
        mode: MobilityMode = 'walking'
    ): number {
        if (fromVenueId === toVenueId) return 0;

        const edge = this.getEdge(fromVenueId, toVenueId);
        if (edge && edge.transitTimeMinutes > 0) {
            return edge.transitTimeMinutes;
        }

        const distanceMeters = edge?.distanceMeters ?? this.calculateDistanceMeters(fromVenueId, toVenueId);
        const speedKmh = DEFAULT_TRANSIT_SPEEDS_KMH[mode] || DEFAULT_TRANSIT_SPEEDS_KMH.walking;
        const speedMpm = (speedKmh * 1000) / 60; // meters per minute

        const calculatedMinutes = distanceMeters / speedMpm;
        return Math.ceil(calculatedMinutes);
    }

    public clear(): void {
        this.nodes.clear();
        this.edges.clear();
    }
}
