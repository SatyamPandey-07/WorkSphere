/**
 * WayfindingGraph.ts
 * Constructs a specialized directed graph from OSM data, tagging edges with accessibility metadata (ramps, elevators, tactile paving).
 * Forms the foundation for constrained shortest-path algorithms for mobility-impaired users.
 */

import type { DirectionVector } from './GradientCalculator';

export interface AccessibilityNode {
    id: string;
    latitude: number;
    longitude: number;
    hasElevator: boolean;
    hasRamp: boolean;
    isTactilePaving: boolean;
    doorWidthCm?: number;
}

export interface AccessibilityEdge {
    fromId: string;
    toId: string;
    distanceMeters: number;
    directionVector?: DirectionVector;
    hasStairs: boolean;
    maxGradientPercent: number;
    surfaceType: 'smooth' | 'rough' | 'gravel' | 'unknown';
    isIndoor: boolean;
}

export class WayfindingGraph {
    private nodes: Map<string, AccessibilityNode>;
    private edges: Map<string, AccessibilityEdge>;

    constructor() {
        this.nodes = new Map();
        this.edges = new Map();
    }

    public addNode(node: AccessibilityNode): void {
        this.nodes.set(node.id, node);
    }

    public addEdge(edge: AccessibilityEdge): void {
        const key = `${edge.fromId}->${edge.toId}`;
        this.edges.set(key, edge);
    }

    public getNode(id: string): AccessibilityNode | undefined {
        return this.nodes.get(id);
    }

    public getOutgoingEdges(nodeId: string): AccessibilityEdge[] {
        return Array.from(this.edges.values()).filter(edge => edge.fromId === nodeId);
    }

    public getAllNodes(): AccessibilityNode[] {
        return Array.from(this.nodes.values());
    }

    public parseOSMData(osmElements: any[]): void {
        for (const element of osmElements) {
            if (element.type === 'node') {
                this.addNode({
                    id: `node-${element.id}`,
                    latitude: element.lat,
                    longitude: element.lon,
                    hasElevator: element.tags?.highway === 'elevator' || element.tags?.amenity === 'elevator',
                    hasRamp: element.tags?.ramp === 'yes',
                    isTactilePaving: element.tags?.tactile_paving === 'yes',
                    doorWidthCm: element.tags?.door_width ? parseInt(element.tags.door_width, 10) : undefined
                });
            }
        }

        for (const element of osmElements) {
            if (element.type === 'way') {
                const hasStairs = element.tags?.highway === 'steps' || element.tags?.stairs === 'yes';
                const gradient = element.tags?.incline ? parseFloat(element.tags.incline) : 0;

                for (let i = 0; i < element.nodes.length - 1; i++) {
                    const fromId = `node-${element.nodes[i]}`;
                    const toId = `node-${element.nodes[i + 1]}`;
                    const fromNode = this.getNode(fromId);
                    const toNode = this.getNode(toId);
                    const directionVector = fromNode && toNode
                        ? this.calculateDirectionVector(fromNode, toNode)
                        : undefined;

                    this.addEdge({
                        fromId,
                        toId,
                        distanceMeters: element.tags?.length ? parseFloat(element.tags.length) : 10,
                        ...(directionVector ? { directionVector } : {}),
                        hasStairs,
                        maxGradientPercent: Math.abs(gradient),
                        surfaceType: element.tags?.surface || 'unknown',
                        isIndoor: element.tags?.indoor === 'yes'
                    });
                }
            }
        }
    }

    private calculateDirectionVector(from: AccessibilityNode, to: AccessibilityNode): DirectionVector {
        const meanLatitude = ((from.latitude + to.latitude) / 2) * (Math.PI / 180);

        return {
            x: (to.longitude - from.longitude) * Math.cos(meanLatitude),
            y: to.latitude - from.latitude
        };
    }
}
