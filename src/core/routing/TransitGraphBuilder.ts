/**
 * TransitGraphBuilder.ts
 * Constructs a unified directed graph merging OSM road networks, transit stops, and micro-mobility docking stations.
 * Normalizes different transport modes into a single traversable graph structure.
 */

import { MicroMobilityVehicle } from './MicroMobilityAggregator';

export interface GraphNode {
    id: string;
    type: 'road_intersection' | 'transit_stop' | 'mobility_dock' | 'venue';
    latitude: number;
    longitude: number;
    metadata?: Record<string, unknown>;
}

export interface GraphEdge {
    fromId: string;
    toId: string;
    mode: 'walking' | 'transit' | 'micro-mobility' | 'driving';
    distanceMeters: number;
    durationSeconds: number;
    cost: number;
    schedule?: {
        departureTime: string;
        arrivalTime: string;
        routeName: string;
    };
}

export class TransitGraphBuilder {
    private nodes: Map<string, GraphNode>;
    private edges: Map<string, GraphEdge>;

    constructor() {
        this.nodes = new Map();
        this.edges = new Map();
    }

    public addNode(node: GraphNode): void {
        this.nodes.set(node.id, node);
    }

    public addEdge(edge: GraphEdge): void {
        const key = `${edge.fromId}->${edge.toId}`;
        this.edges.set(key, edge);
    }

    public mergeMicroMobilityData(vehicles: MicroMobilityVehicle[], venueId: string): void {
        for (const vehicle of vehicles) {
            const dockId = `dock-${vehicle.id}`;
            this.addNode({
                id: dockId,
                type: 'mobility_dock',
                latitude: vehicle.latitude,
                longitude: vehicle.longitude,
                metadata: { vehicleId: vehicle.id, provider: vehicle.provider }
            });

            // Edge from dock to venue (simulated walking/riding)
            this.addEdge({
                fromId: dockId,
                toId: venueId,
                mode: 'micro-mobility',
                distanceMeters: 500, // Mock distance
                durationSeconds: 180, // 3 minutes
                cost: vehicle.pricePerMinute * 3,
            });
        }
    }

    public getNodes(): GraphNode[] {
        return Array.from(this.nodes.values());
    }

    public getEdges(): GraphEdge[] {
        return Array.from(this.edges.values());
    }

    public getOutgoingEdges(nodeId: string): GraphEdge[] {
        return Array.from(this.edges.values()).filter((edge) => edge.fromId === nodeId);
    }
}
