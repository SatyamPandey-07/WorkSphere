/**
 * paretoOptimalRouter.ts
 *
 * Multi-objective routing on top of the MultimodalGraphEngine. A modified
 * Dijkstra / label-setting search keeps the set of non-dominated paths at every
 * node, where dominance is evaluated over four additive objectives:
 *
 *   - travel time (minutes)
 *   - noise exposure (dB · minutes)
 *   - shade-deficit exposure ((1 - shade) · minutes)
 *   - air-pollution exposure (air · minutes)
 *
 * The destination labels form the Pareto frontier, so callers can present
 * "Fastest", "Quiet" and "Scenic / Green" alternatives without letting one
 * objective silently dominate the others.
 */

import {
    MultimodalGraphEngine,
    PathAccumulator,
    PathMetrics,
    RouteOption,
    accumulatorToMetrics,
    addAccumulators,
    edgeAccumulator,
} from '@/core/spatial/MultimodalGraphEngine';

export interface ParetoObjectives {
    timeMinutes: number;
    noiseExposure: number;
    shadeDeficitExposure: number;
    airExposure: number;
}

export interface ParetoFrontierEntry {
    path: string[];
    metrics: PathMetrics;
    objectives: ParetoObjectives;
}

export interface ParetoRoutingResult {
    options: RouteOption[];
    frontier: ParetoFrontierEntry[];
}

export interface ParetoOptimalRouterOptions {
    /** Safety cap on non-dominated labels kept per node. Defaults to 64. */
    maxLabelsPerNode?: number;
}

const OBJECTIVE_KEYS: (keyof ParetoObjectives)[] = [
    'timeMinutes',
    'noiseExposure',
    'shadeDeficitExposure',
    'airExposure',
];

const EPSILON = 1e-9;

const ZERO_ACCUMULATOR: PathAccumulator = {
    timeMinutes: 0,
    noiseExposure: 0,
    shadeDeficitExposure: 0,
    airExposure: 0,
};

interface Label {
    node: string;
    accumulator: PathAccumulator;
    path: string[];
}

function objectivesOf(accumulator: PathAccumulator): ParetoObjectives {
    return {
        timeMinutes: accumulator.timeMinutes,
        noiseExposure: accumulator.noiseExposure,
        shadeDeficitExposure: accumulator.shadeDeficitExposure,
        airExposure: accumulator.airExposure,
    };
}

/** True when `a` is no worse than `b` on every objective and better on at least one. */
export function dominates(a: ParetoObjectives, b: ParetoObjectives): boolean {
    let strictlyBetter = false;
    for (const key of OBJECTIVE_KEYS) {
        if (a[key] > b[key] + EPSILON) {
            return false;
        }
        if (a[key] < b[key] - EPSILON) {
            strictlyBetter = true;
        }
    }
    return strictlyBetter;
}

export class ParetoOptimalRouter {
    private readonly engine: MultimodalGraphEngine;
    private readonly maxLabelsPerNode: number;

    constructor(engine: MultimodalGraphEngine, options: ParetoOptimalRouterOptions = {}) {
        this.engine = engine;
        this.maxLabelsPerNode = Math.max(1, Math.floor(options.maxLabelsPerNode ?? 64));
    }

    /** Ranked "Fastest", "Quiet" and "Scenic / Green" options. */
    public findRouteOptions(startId: string, endId: string): RouteOption[] {
        return this.engine.findRouteOptions(startId, endId);
    }

    /**
     * Pareto frontier of non-dominated paths between two nodes. Returns an
     * empty array when the destination is unreachable.
     */
    public findParetoFrontier(startId: string, endId: string): ParetoFrontierEntry[] {
        if (!this.engine.hasNode(startId) || !this.engine.hasNode(endId)) {
            return [];
        }

        if (startId === endId) {
            return [
                {
                    path: [startId],
                    metrics: accumulatorToMetrics(ZERO_ACCUMULATOR),
                    objectives: objectivesOf(ZERO_ACCUMULATOR),
                },
            ];
        }

        const startLabel: Label = {
            node: startId,
            accumulator: { ...ZERO_ACCUMULATOR },
            path: [startId],
        };
        const labelsByNode = new Map<string, Label[]>();
        labelsByNode.set(startId, [startLabel]);

        const queue: Label[] = [startLabel];

        while (queue.length > 0) {
            const label = queue.shift()!;
            if (label.node === endId) {
                continue;
            }

            for (const edge of this.engine.getOutgoingEdges(label.node)) {
                // Keep paths simple to bound the search space.
                if (label.path.includes(edge.to)) {
                    continue;
                }

                const nextAccumulator = addAccumulators(
                    label.accumulator,
                    edgeAccumulator(edge)
                );
                const nextObjectives = objectivesOf(nextAccumulator);
                const nextLabel: Label = {
                    node: edge.to,
                    accumulator: nextAccumulator,
                    path: [...label.path, edge.to],
                };

                const existing = labelsByNode.get(edge.to) ?? [];
                if (existing.some((candidate) => dominates(objectivesOf(candidate.accumulator), nextObjectives))) {
                    continue;
                }

                let kept = existing.filter(
                    (candidate) => !dominates(nextObjectives, objectivesOf(candidate.accumulator))
                );
                kept.push(nextLabel);

                if (kept.length > this.maxLabelsPerNode) {
                    kept.sort(
                        (a, b) => a.accumulator.timeMinutes - b.accumulator.timeMinutes
                    );
                    kept = kept.slice(0, this.maxLabelsPerNode);
                }

                labelsByNode.set(edge.to, kept);

                if (kept.includes(nextLabel)) {
                    queue.push(nextLabel);
                }
            }
        }

        const terminalLabels = labelsByNode.get(endId) ?? [];
        const seenPaths = new Set<string>();
        const frontier: ParetoFrontierEntry[] = [];

        for (const label of terminalLabels) {
            const key = label.path.join('>');
            if (seenPaths.has(key)) {
                continue;
            }
            seenPaths.add(key);
            frontier.push({
                path: label.path,
                metrics: accumulatorToMetrics(label.accumulator),
                objectives: objectivesOf(label.accumulator),
            });
        }

        return frontier.sort((a, b) => a.objectives.timeMinutes - b.objectives.timeMinutes);
    }

    /** Convenience call returning both the ranked options and the frontier. */
    public route(startId: string, endId: string): ParetoRoutingResult {
        return {
            options: this.findRouteOptions(startId, endId),
            frontier: this.findParetoFrontier(startId, endId),
        };
    }
}

export function createParetoOptimalRouter(
    engine: MultimodalGraphEngine,
    options: ParetoOptimalRouterOptions = {}
): ParetoOptimalRouter {
    return new ParetoOptimalRouter(engine, options);
}
