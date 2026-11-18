/**
 * MultimodalGraphEngine.ts
 *
 * Multi-objective pedestrian routing graph for remote workers moving between
 * workspaces. Instead of optimizing only travel time, it scores each segment
 * with a weighted environmental cost:
 *
 *   C = w_t * T + w_n * N_dB + w_s * (1 - S_shade) + w_a * A_air
 *
 * T is travel time in minutes. N_dB, (1 - S_shade) and A_air are accumulated
 * along the path as time-weighted exposure so the cost stays additive and can
 * be minimized with Dijkstra's algorithm. The engine exposes the scalar
 * weighted search plus the "Fastest", "Quiet" and "Scenic / Green" presets.
 */

export interface GraphNode {
    id: string;
    label?: string;
    lat?: number;
    lon?: number;
}

export interface EnvironmentalEdge {
    from: string;
    to: string;
    /** Traversal time in seconds. */
    travelTimeSeconds: number;
    /** Acoustic noise along the segment in decibels. */
    noiseDb: number;
    /** Canopy shade coverage, 0 = fully exposed, 1 = fully shaded. */
    shadeFactor: number;
    /** Normalized air pollution, 0 = pristine, 1 = hazardous. */
    airPollution: number;
    /** Whether the segment can be walked in both directions. Defaults to true. */
    bidirectional?: boolean;
}

export interface RouteWeights {
    time: number;
    noise: number;
    shade: number;
    air: number;
}

export interface PathMetrics {
    travelTimeSeconds: number;
    averageNoiseDb: number;
    averageShadeFactor: number;
    averageAirPollution: number;
}

export type RoutePreference = 'Fastest' | 'Quiet' | 'Scenic / Green';

export const ROUTE_PREFERENCES: RoutePreference[] = ['Fastest', 'Quiet', 'Scenic / Green'];

export const DEFAULT_ROUTE_WEIGHTS: Record<RoutePreference, RouteWeights> = {
    Fastest: { time: 1, noise: 0, shade: 0, air: 0 },
    Quiet: { time: 0.05, noise: 1, shade: 0, air: 0 },
    'Scenic / Green': { time: 0.05, noise: 0, shade: 1, air: 1 },
};

export interface WeightedPathResult {
    path: string[];
    metrics: PathMetrics;
    cost: number;
    weights: RouteWeights;
}

export interface RouteOption extends WeightedPathResult {
    preference: RoutePreference;
}

/** Additive path accumulators used by the search. */
export interface PathAccumulator {
    timeMinutes: number;
    noiseExposure: number;
    shadeDeficitExposure: number;
    airExposure: number;
}

const ZERO_ACCUMULATOR: PathAccumulator = {
    timeMinutes: 0,
    noiseExposure: 0,
    shadeDeficitExposure: 0,
    airExposure: 0,
};

function clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
}

function isFiniteNonNegative(value: number): boolean {
    return Number.isFinite(value) && value >= 0;
}

/** Per-edge contribution to the additive path accumulator. */
export function edgeAccumulator(edge: EnvironmentalEdge): PathAccumulator {
    const timeMinutes = edge.travelTimeSeconds / 60;
    return {
        timeMinutes,
        noiseExposure: edge.noiseDb * timeMinutes,
        shadeDeficitExposure: (1 - clamp01(edge.shadeFactor)) * timeMinutes,
        airExposure: clamp01(edge.airPollution) * timeMinutes,
    };
}

export function addAccumulators(a: PathAccumulator, b: PathAccumulator): PathAccumulator {
    return {
        timeMinutes: a.timeMinutes + b.timeMinutes,
        noiseExposure: a.noiseExposure + b.noiseExposure,
        shadeDeficitExposure: a.shadeDeficitExposure + b.shadeDeficitExposure,
        airExposure: a.airExposure + b.airExposure,
    };
}

/** Converts additive accumulators into human-readable path metrics. */
export function accumulatorToMetrics(accumulator: PathAccumulator): PathMetrics {
    const minutes = accumulator.timeMinutes;
    if (minutes <= 0) {
        return {
            travelTimeSeconds: 0,
            averageNoiseDb: 0,
            averageShadeFactor: 1,
            averageAirPollution: 0,
        };
    }
    return {
        travelTimeSeconds: accumulator.timeMinutes * 60,
        averageNoiseDb: accumulator.noiseExposure / minutes,
        averageShadeFactor: 1 - accumulator.shadeDeficitExposure / minutes,
        averageAirPollution: accumulator.airExposure / minutes,
    };
}

export class MultimodalGraphEngine {
    private nodes: Map<string, GraphNode> = new Map();
    private adjacency: Map<string, EnvironmentalEdge[]> = new Map();

    public addNode(node: GraphNode): this {
        if (!node.id || !node.id.trim()) {
            throw new RangeError('Node id is required.');
        }
        this.nodes.set(node.id, { ...node });
        if (!this.adjacency.has(node.id)) {
            this.adjacency.set(node.id, []);
        }
        return this;
    }

    public addEdge(edge: EnvironmentalEdge): this {
        const sanitized = this.sanitizeEdge(edge);
        this.addNode({ id: sanitized.from });
        this.addNode({ id: sanitized.to });

        this.adjacency.get(sanitized.from)!.push(sanitized);

        if (sanitized.bidirectional !== false) {
            this.adjacency.get(sanitized.to)!.push({
                ...sanitized,
                from: sanitized.to,
                to: sanitized.from,
            });
        }

        return this;
    }

    public getNodes(): GraphNode[] {
        return Array.from(this.nodes.values());
    }

    public getOutgoingEdges(nodeId: string): EnvironmentalEdge[] {
        return this.adjacency.get(nodeId) ?? [];
    }

    public hasNode(nodeId: string): boolean {
        return this.nodes.has(nodeId);
    }

    /**
     * Weighted scalar cost for a path, derived from its aggregate metrics.
     * Exposure terms are reconstructed as (average value × travel minutes).
     */
    public calculateCost(metrics: PathMetrics, weights: RouteWeights): number {
        const minutes = metrics.travelTimeSeconds / 60;
        return (
            weights.time * minutes +
            weights.noise * metrics.averageNoiseDb * minutes +
            weights.shade * (1 - clamp01(metrics.averageShadeFactor)) * minutes +
            weights.air * clamp01(metrics.averageAirPollution) * minutes
        );
    }

    /**
     * Dijkstra search minimizing the weighted environmental cost.
     */
    public findWeightedPath(
        startId: string,
        endId: string,
        weights: RouteWeights
    ): WeightedPathResult | null {
        if (!this.hasNode(startId) || !this.hasNode(endId)) {
            return null;
        }

        const distances = new Map<string, number>();
        const previous = new Map<string, string | null>();
        const accumulators = new Map<string, PathAccumulator>();

        for (const nodeId of this.nodes.keys()) {
            distances.set(nodeId, Infinity);
            previous.set(nodeId, null);
            accumulators.set(nodeId, { ...ZERO_ACCUMULATOR });
        }

        distances.set(startId, 0);
        const queue = new MinHeap();
        queue.push(startId, 0);

        while (queue.size > 0) {
            const { value: current, priority } = queue.pop();
            if (priority > (distances.get(current) ?? Infinity)) {
                continue;
            }
            if (current === endId) {
                break;
            }

            for (const edge of this.getOutgoingEdges(current)) {
                const step = edgeAccumulator(edge);
                const stepCost =
                    weights.time * step.timeMinutes +
                    weights.noise * step.noiseExposure +
                    weights.shade * step.shadeDeficitExposure +
                    weights.air * step.airExposure;
                const candidate = priority + stepCost;

                if (candidate < (distances.get(edge.to) ?? Infinity)) {
                    distances.set(edge.to, candidate);
                    previous.set(edge.to, current);
                    accumulators.set(
                        edge.to,
                        addAccumulators(accumulators.get(current) ?? ZERO_ACCUMULATOR, step)
                    );
                    queue.push(edge.to, candidate);
                }
            }
        }

        const totalCost = distances.get(endId) ?? Infinity;
        if (!Number.isFinite(totalCost)) {
            return null;
        }

        const path = this.reconstructPath(previous, startId, endId);
        if (path === null) {
            return null;
        }

        const metrics = accumulatorToMetrics(accumulators.get(endId) ?? ZERO_ACCUMULATOR);
        return { path, metrics, cost: totalCost, weights };
    }

    /**
     * Returns the ranked "Fastest", "Quiet" and "Scenic / Green" options.
     */
    public findRouteOptions(startId: string, endId: string): RouteOption[] {
        const options: RouteOption[] = [];
        for (const preference of ROUTE_PREFERENCES) {
            const result = this.findWeightedPath(startId, endId, DEFAULT_ROUTE_WEIGHTS[preference]);
            if (result) {
                options.push({ preference, ...result });
            }
        }
        return options;
    }

    private reconstructPath(
        previous: Map<string, string | null>,
        startId: string,
        endId: string
    ): string[] | null {
        if (startId === endId) {
            return [startId];
        }
        if (previous.get(endId) === null) {
            return null;
        }

        const path: string[] = [];
        let cursor: string | null = endId;
        while (cursor !== null) {
            path.unshift(cursor);
            cursor = previous.get(cursor) ?? null;
        }

        return path[0] === startId ? path : null;
    }

    private sanitizeEdge(edge: EnvironmentalEdge): EnvironmentalEdge {
        if (!edge.from || !edge.from.trim() || !edge.to || !edge.to.trim()) {
            throw new RangeError('Edge endpoints are required.');
        }
        if (!isFiniteNonNegative(edge.travelTimeSeconds)) {
            throw new RangeError('travelTimeSeconds must be finite and non-negative.');
        }
        if (!isFiniteNonNegative(edge.noiseDb)) {
            throw new RangeError('noiseDb must be finite and non-negative.');
        }
        if (!Number.isFinite(edge.shadeFactor)) {
            throw new RangeError('shadeFactor must be finite.');
        }
        if (!Number.isFinite(edge.airPollution)) {
            throw new RangeError('airPollution must be finite.');
        }

        return {
            ...edge,
            shadeFactor: clamp01(edge.shadeFactor),
            airPollution: clamp01(edge.airPollution),
        };
    }
}

/** Minimal binary min-heap keyed by numeric priority. */
class MinHeap {
    private items: { value: string; priority: number }[] = [];

    public get size(): number {
        return this.items.length;
    }

    public push(value: string, priority: number): void {
        this.items.push({ value, priority });
        this.bubbleUp(this.items.length - 1);
    }

    public pop(): { value: string; priority: number } {
        const top = this.items[0];
        const last = this.items.pop()!;
        if (this.items.length > 0) {
            this.items[0] = last;
            this.sinkDown(0);
        }
        return top;
    }

    private bubbleUp(index: number): void {
        let current = index;
        while (current > 0) {
            const parent = Math.floor((current - 1) / 2);
            if (this.items[parent].priority <= this.items[current].priority) {
                break;
            }
            [this.items[parent], this.items[current]] = [this.items[current], this.items[parent]];
            current = parent;
        }
    }

    private sinkDown(index: number): void {
        let current = index;
        const length = this.items.length;
        while (true) {
            const left = current * 2 + 1;
            const right = current * 2 + 2;
            let smallest = current;

            if (left < length && this.items[left].priority < this.items[smallest].priority) {
                smallest = left;
            }
            if (right < length && this.items[right].priority < this.items[smallest].priority) {
                smallest = right;
            }
            if (smallest === current) {
                break;
            }
            [this.items[smallest], this.items[current]] = [this.items[current], this.items[smallest]];
            current = smallest;
        }
    }
}
