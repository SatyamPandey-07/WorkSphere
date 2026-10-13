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

export const ADA_MIN_CORRIDOR_WIDTH_CM = 91; // 36 inches minimum clear corridor width per ADA standards
export const ADA_MIN_TURN_CORRIDOR_WIDTH_CM = 100; // Recommended minimum turning clear width

export interface NavigationInstructionCard {
    stepIndex: number;
    fromNodeId: string;
    toNodeId: string;
    instruction: string;
    distanceMeters: number;
    corridorClearanceCm?: number;
    hasWheelchairTurningWarning: boolean;
    warningMessage?: string;
    warningBadge?: {
        label: string;
        severity: 'advisory' | 'warning' | 'critical';
        code: 'NARROW_CORRIDOR' | 'TIGHT_TURNING_RADIUS';
    };
    vibrationPattern?: number[];
    decisionPoint?: 'left' | 'right' | 'straight' | 'destination' | 'decision_point';
}

export interface AccessibleRouteSuccess {
    success?: true;
    path: string[];
    totalDistanceMeters: number;
    accessibilityScore: number;
    warnings: string[];
    hasWheelchairTurningWarning?: boolean;
    instructionCards?: NavigationInstructionCard[];
}

export interface AccessibleRouteFailure {
    success: false;
    reason: 'NO_ACCESSIBLE_PATH_EXISTS';
    message: string;
    detourRecommendations?: string[];
}

export type AccessibleRoute = AccessibleRouteSuccess;
export type RouteResult = AccessibleRouteSuccess | AccessibleRouteFailure;

export class AccessibilityRouter {
    private graph: WayfindingGraph;
    private profile: MobilityProfile;

    constructor(graph: WayfindingGraph, profile: MobilityProfile) {
        this.graph = graph;
        this.profile = profile;
    }

    public findOptimalRoute(startId: string, endId: string): (AccessibleRouteSuccess & { success: true }) | AccessibleRouteFailure {
        const startNode = this.graph.getNode(startId);
        const endNode = this.graph.getNode(endId);

        if (!startNode || !endNode) {
            return {
                success: false,
                reason: 'NO_ACCESSIBLE_PATH_EXISTS',
                message: `One or both route nodes do not exist in graph (${startId} -> ${endId}).`,
                detourRecommendations: ['Verify venue room identifiers or request staff assistance.']
            };
        }

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

            // Stop early if reached end node or remaining nodes are unreachable
            if (u === endId) break;
            if (current.priority === Infinity) break;

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

        const endDistance = distances.get(endId);
        if (endDistance === undefined || endDistance === Infinity || (previous.get(endId) === null && startId !== endId)) {
            // Disconnected node or inaccessible route (#5488)
            const detours = this.generateDetourRecommendations(endId);
            return {
                success: false,
                reason: 'NO_ACCESSIBLE_PATH_EXISTS',
                message: `No accessible path exists between ${startId} and ${endId}. Target may only be reachable via stairs or steep incline.`,
                detourRecommendations: detours
            };
        }

        const route = this.reconstructRoute(previous, warnings, startId, endId, endDistance);
        if (!route) {
            return {
                success: false,
                reason: 'NO_ACCESSIBLE_PATH_EXISTS',
                message: `Unable to trace accessible route to ${endId}.`,
                detourRecommendations: this.generateDetourRecommendations(endId)
            };
        }

        return {
            success: true,
            ...route
        };
    }

    private generateDetourRecommendations(targetNodeId: string): string[] {
        const recommendations: string[] = [];
        const incomingEdges = this.graph.getIncomingEdges(targetNodeId);
        const hasStairs = incomingEdges.some(e => e.hasStairs);
        const hasSteepGradient = incomingEdges.some(e => e.maxGradientPercent > this.profile.maxAcceptableGradient);

        if (hasStairs) {
            recommendations.push('Target location is connected via stairs. Check for an alternative elevator or ramp entrance.');
        }
        if (hasSteepGradient) {
            recommendations.push('Approach contains steep gradients exceeding profile limit. Look for designated ADA pathways.');
        }
        if (incomingEdges.length === 0) {
            recommendations.push('Target room appears isolated on floorplan. Please contact venue reception for accessible escort.');
        }
        if (recommendations.length === 0) {
            recommendations.push('Use venue elevator to the nearest accessible floor and approach via corridor.');
        }

        return recommendations;
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

        const instructionCards: NavigationInstructionCard[] = [];
        let routeHasTurningWarning = false;

        for (let i = 0; i < path.length - 1; i++) {
            const fromNodeId = path[i];
            const toNodeId = path[i + 1];
            const edge = this.graph.getEdge(fromNodeId, toNodeId);
            const distance = edge?.distanceMeters ?? 10;
            const clearance = edge?.corridorClearanceCm;
            const isSharpCorner = edge?.isSharpCorner ?? false;

            let hasTurningWarning = false;
            let warningMessage: string | undefined;
            let warningBadge: NavigationInstructionCard['warningBadge'];

            if (this.profile.usesWheelchair) {
                if (clearance !== undefined && clearance < ADA_MIN_CORRIDOR_WIDTH_CM) {
                    hasTurningWarning = true;
                    routeHasTurningWarning = true;
                    warningMessage = `Corridor width (${clearance}cm) is below ADA standard (< 91cm / 36 in). Tight wheelchair clearance.`;
                    warningBadge = {
                        label: `Tight Corridor: ${clearance}cm`,
                        severity: clearance < 80 ? 'critical' : 'warning',
                        code: 'NARROW_CORRIDOR'
                    };
                    allWarnings.add(`Narrow corridor (${clearance}cm < 91cm) on segment ${fromNodeId} to ${toNodeId}`);
                } else if (isSharpCorner && (clearance === undefined || clearance < ADA_MIN_TURN_CORRIDOR_WIDTH_CM)) {
                    hasTurningWarning = true;
                    routeHasTurningWarning = true;
                    const clearanceText = clearance ? ` (${clearance}cm)` : '';
                    warningMessage = `Sharp 90-degree corner with limited turning radius${clearanceText}. Exercise caution with wheelchair navigation.`;
                    warningBadge = {
                        label: 'Tight Turning Radius',
                        severity: 'warning',
                        code: 'TIGHT_TURNING_RADIUS'
                    };
                    allWarnings.add(`Sharp corner with tight turning radius on segment ${fromNodeId} to ${toNodeId}`);
                }
            }

            const isLastStep = i === path.length - 2;
            let decisionPoint: NavigationInstructionCard['decisionPoint'] = 'straight';
            if (isLastStep) {
                decisionPoint = 'destination';
            } else if (edge?.turnDirection === 'left') {
                decisionPoint = 'left';
            } else if (edge?.turnDirection === 'right') {
                decisionPoint = 'right';
            } else if (isSharpCorner) {
                decisionPoint = 'decision_point';
            }

            const vibrationPattern = this.graph.getHapticPatternForTurn(decisionPoint);

            instructionCards.push({
                stepIndex: i,
                fromNodeId,
                toNodeId,
                instruction: `Proceed from ${fromNodeId} to ${toNodeId} (${distance}m)`,
                distanceMeters: distance,
                corridorClearanceCm: clearance,
                hasWheelchairTurningWarning: hasTurningWarning,
                warningMessage,
                warningBadge,
                decisionPoint,
                vibrationPattern
            });
        }

        return {
            path,
            totalDistanceMeters: totalDistance,
            accessibilityScore: allWarnings.size === 0 ? 100 : Math.max(0, 100 - (allWarnings.size * 10)),
            warnings: Array.from(allWarnings),
            hasWheelchairTurningWarning: routeHasTurningWarning,
            instructionCards
        };
    }
}
