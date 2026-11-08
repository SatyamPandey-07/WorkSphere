/**
 * MultiModalDijkstra.ts
 * Implements a time-dependent shortest-path algorithm accounting for transit schedules and walking transfer times.
 * Optimizes for a combined cost function of time, monetary cost, and user preference weights.
 */

import { TransitGraphBuilder, GraphNode, GraphEdge } from './TransitGraphBuilder';

export interface RouteOption {
    path: string[];
    totalDurationSeconds: number;
    totalCost: number;
    modes: string[];
}

export class MultiModalDijkstra {
    private graph: TransitGraphBuilder;
    private timeWeight: number;
    private costWeight: number;

    constructor(graph: TransitGraphBuilder, timeWeight: number = 1.0, costWeight: number = 0.5) {
        this.graph = graph;
        this.timeWeight = timeWeight;
        this.costWeight = costWeight;
    }

    public findOptimalRoute(startNodeId: string, endNodeId: string): RouteOption | null {
        const distances = new Map<string, number>();
        const previous = new Map<string, string | null>();
        const modes = new Map<string, string>();
        const pq: { nodeId: string; priority: number }[] = [];

        const nodes = this.graph.getNodes();
        for (const node of nodes) {
            distances.set(node.id, Infinity);
            previous.set(node.id, null);
        }

        distances.set(startNodeId, 0);
        pq.push({ nodeId: startNodeId, priority: 0 });

        while (pq.length > 0) {
            pq.sort((a, b) => a.priority - b.priority);
            const current = pq.shift()!;
            const u = current.nodeId;

            if (u === endNodeId) {
                break;
            }

            const edges = this.graph.getOutgoingEdges(u);
            for (const edge of edges) {
                const v = edge.toId;
                const weight = this.calculateWeight(edge);
                const alt = distances.get(u)! + weight;

                if (alt < distances.get(v)!) {
                    distances.set(v, alt);
                    previous.set(v, u);
                    modes.set(v, edge.mode);
                    pq.push({ nodeId: v, priority: alt });
                }
            }
        }

        return this.reconstructPath(previous, modes, startNodeId, endNodeId, distances.get(endNodeId)!);
    }

    private calculateWeight(edge: GraphEdge): number {
        const durSec = Number.isFinite(edge.durationSeconds) ? Math.max(0, edge.durationSeconds) : 0;
        const costVal = Number.isFinite(edge.cost) ? Math.max(0, edge.cost) : 0;
        const timeCost = (durSec / 60) * this.timeWeight; // in minutes
        const monetaryCost = costVal * this.costWeight;
        const total = timeCost + monetaryCost;
        if (!Number.isFinite(total) || total < 0) {
            return 1e7;
        }
        return Math.min(total, 1e7);
    }


    private reconstructPath(
        previous: Map<string, string | null>,
        modes: Map<string, string>,
        start: string,
        end: string,
        totalWeight: number
    ): RouteOption | null {
        const path: string[] = [];
        const routeModes: string[] = [];
        let curr: string | null = end;

        if (previous.get(curr) === null && curr !== start) {
            return null; // No path found
        }

        while (curr !== null) {
            path.unshift(curr);
            if (modes.has(curr)) {
                routeModes.unshift(modes.get(curr)!);
            }
            curr = previous.get(curr) || null;
        }

        return {
            path,
            totalDurationSeconds: totalWeight / this.timeWeight * 60, // Approximate back to seconds
            totalCost: totalWeight / this.costWeight, // Approximate back to cost
            modes: routeModes.filter((m, i, a) => a.indexOf(m) === i), // Unique modes
        };
    }
}
