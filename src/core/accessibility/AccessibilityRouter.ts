/**
 * AccessibilityRouter.ts
 * Implements a constrained shortest-path algorithm that strictly avoids stairs and steep gradients based on user mobility profiles.
 * Modifies Dijkstra's algorithm to apply infinite penalties to inaccessible edges.
 */

import { WayfindingGraph, AccessibilityEdge } from './WayfindingGraph';

export interface MobilityProfile {
    usesWheelchair: boolean;
    hasVisualImpairment: boolean;
    maxAcceptableGradient: number;
    prefersIndoor: boolean;
}

export interface AccessibleRoute {
    path: string[];
    totalDistanceMeters: number;
    accessibilityScore: number;
    warnings: string[];
}

export class AccessibilityRouter {
    private graph: WayfindingGraph;
    private profile: MobilityProfile;

    constructor(graph: WayfindingGraph, profile: MobilityProfile) {
        this.graph = graph;
        this.profile = profile;
    }

    public findOptimalRoute(startId: string, endId: string): AccessibleRoute | null {
        const distances = new Map<string, number>();
        const previous = new Map<string, string | null>();
        const warnings = new Map<string, string[]>();
        const pq: { nodeId: string; priority: number }[] = [];

        const nodes = this.graph.getAllNodes();
        for (const node of nodes) {
            distances.set(node.id, Infinity);
            previous.set(node.id, null);
            warnings.set(node.id, []);
        }

        distances.set(startId, 0);
        pq.push({ nodeId: startId, priority: 0 });

        while (pq.length > 0) {
            pq.sort((a, b) => a.priority - b.priority);
            const current = pq.shift()!;
            const u = current.nodeId;

            if (u === endId) break;

            const edges = this.graph.getOutgoingEdges(u);
            for (const edge of edges) {
                if (!this.isEdgeAccessible(edge)) {
                    continue;
                }

                const weight = this.calculateEdgeWeight(edge);
                const alt = distances.get(u)! + weight;

                if (alt < distances.get(edge.toId)!) {
                    distances.set(edge.toId, alt);
                    previous.set(edge.toId, u);

                    const nodeWarnings = [...(warnings.get(u) || [])];
                    if (edge.maxGradientPercent > 5) {
                        nodeWarnings.push(`Steep gradient (${edge.maxGradientPercent}%) on segment to ${edge.toId}`);
                    }
                    warnings.set(edge.toId, nodeWarnings);

                    pq.push({ nodeId: edge.toId, priority: alt });
                }
            }
        }

        return this.reconstructRoute(previous, warnings, startId, endId, distances.get(endId)!);
    }

    private isEdgeAccessible(edge: AccessibilityEdge): boolean {
        if (this.profile.usesWheelchair && edge.hasStairs) {
            return false;
        }
        if (this.profile.usesWheelchair && edge.maxGradientPercent > this.profile.maxAcceptableGradient) {
            return false;
        }
        if (this.profile.prefersIndoor && !edge.isIndoor && edge.surfaceType === 'gravel') {
            return false;
        }
        return true;
    }

    private calculateEdgeWeight(edge: AccessibilityEdge): number {
        let weight = edge.distanceMeters;

        if (this.profile.hasVisualImpairment && edge.surfaceType === 'rough') {
            weight *= 1.5;
        }

        if (edge.maxGradientPercent > 5) {
            weight *= (1 + (edge.maxGradientPercent / 10));
        }

        return weight;
    }

    private reconstructRoute(
        previous: Map<string, string | null>,
        warnings: Map<string, string[]>,
        start: string,
        end: string,
        totalDistance: number
    ): AccessibleRoute | null {
        const path: string[] = [];
        let curr: string | null = end;
        const allWarnings = new Set<string>();

        if (previous.get(curr) === null && curr !== start) {
            return null;
        }

        while (curr !== null) {
            path.unshift(curr);
            const nodeWarnings = warnings.get(curr) || [];
            nodeWarnings.forEach(w => allWarnings.add(w));
            curr = previous.get(curr) || null;
        }

        return {
            path,
            totalDistanceMeters: totalDistance,
            accessibilityScore: allWarnings.size === 0 ? 100 : Math.max(0, 100 - (allWarnings.size * 10)),
            warnings: Array.from(allWarnings)
        };
    }
}
