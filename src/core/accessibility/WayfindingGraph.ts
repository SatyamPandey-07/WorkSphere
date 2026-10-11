/**
 * WayfindingGraph.ts
 * Constructs a specialized directed graph from OSM data, tagging edges with accessibility metadata (ramps, elevators, tactile paving).
 * Forms the foundation for constrained shortest-path algorithms for mobility-impaired users.
 */

export interface AccessibilityNode {
    id: string;
    latitude: number;
    longitude: number;
    hasElevator: boolean;
    hasRamp: boolean;
    isTactilePaving: boolean;
    doorWidthCm?: number;
}

export type TurnDirection = 'left' | 'right' | 'slight_left' | 'slight_right' | 'straight' | 'u_turn' | 'destination';

export type NavigationalDecisionPoint = 'left' | 'right' | 'straight' | 'destination' | 'decision_point';

/**
 * Distinct haptic vibration signatures for navigational decision points:
 * - Single pulse for left ([200])
 * - Double pulse for right ([150, 100, 150])
 * - Long pulse for destination ([600])
 * - Triple pulse for decision point / intersection ([100, 80, 100, 80, 100])
 */
export const HAPTIC_VIBRATION_PATTERNS = {
    LEFT: [200],                           // Single pulse for left
    RIGHT: [150, 100, 150],                // Double pulse for right
    STRAIGHT: [100],                       // Short confirmation pulse for straight
    DESTINATION: [600],                    // Long pulse for destination arrival
    DECISION_POINT: [100, 80, 100, 80, 100]// Distinct multi-pulse for decision point
} as const;

export interface TactileGuidanceCue {
    decisionPoint: NavigationalDecisionPoint;
    turnDirection: TurnDirection;
    pattern: number[];
    instruction: string;
    nodeId?: string;
}

export interface TactileGuidanceOptions {
    enabled?: boolean;
    navigator?: Navigator;
}

export interface AccessibilityEdge {
    fromId: string;
    toId: string;
    distanceMeters: number;
    hasStairs: boolean;
    maxGradientPercent: number;
    surfaceType: 'smooth' | 'rough' | 'gravel' | 'unknown';
    isIndoor: boolean;
    corridorClearanceCm?: number;
    isSharpCorner?: boolean;
    turnDirection?: TurnDirection;
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

    public getEdge(fromId: string, toId: string): AccessibilityEdge | undefined {
        return this.edges.get(`${fromId}->${toId}`);
    }

    public getIncomingEdges(nodeId: string): AccessibilityEdge[] {
        return Array.from(this.edges.values()).filter(edge => edge.toId === nodeId);
    }

    public getAllNodes(): AccessibilityNode[] {
        return Array.from(this.nodes.values());
    }

    public isNodeConnected(nodeId: string): boolean {
        return this.getOutgoingEdges(nodeId).length > 0 || this.getIncomingEdges(nodeId).length > 0;
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
            } else if (element.type === 'way') {
                const hasStairs = element.tags?.highway === 'steps' || element.tags?.stairs === 'yes';
                const gradient = element.tags?.incline ? parseFloat(element.tags.incline) : 0;
                const widthTag = element.tags?.width || element.tags?.clearance || element.tags?.corridor_width;
                const corridorClearanceCm = widthTag ? Math.round(parseFloat(widthTag) * (String(widthTag).includes('m') || parseFloat(widthTag) < 10 ? 100 : 1)) : undefined;
                const isSharpCorner = element.tags?.corner === 'sharp' || element.tags?.turn === '90_degree' || element.tags?.sharp_turn === 'yes';
                const turnTag = element.tags?.turn || element.tags?.maneuver;
                const turnDirection: TurnDirection | undefined =
                    turnTag === 'left' || turnTag === 'sharp_left' || turnTag === 'slight_left' ? 'left'
                    : turnTag === 'right' || turnTag === 'sharp_right' || turnTag === 'slight_right' ? 'right'
                    : turnTag === 'straight' ? 'straight'
                    : undefined;

                for (let i = 0; i < element.nodes.length - 1; i++) {
                    this.addEdge({
                        fromId: `node-${element.nodes[i]}`,
                        toId: `node-${element.nodes[i + 1]}`,
                        distanceMeters: element.tags?.length ? parseFloat(element.tags.length) : 10,
                        hasStairs,
                        maxGradientPercent: Math.abs(gradient),
                        surfaceType: element.tags?.surface || 'unknown',
                        isIndoor: element.tags?.indoor === 'yes',
                        corridorClearanceCm,
                        isSharpCorner,
                        turnDirection
                    });
                }
            }
        }
    }

    /**
     * Resolves the distinct haptic vibration signature pattern for a given decision point or turn.
     * - Single pulse for left: [200]
     * - Double pulse for right: [150, 100, 150]
     * - Long pulse for destination: [600]
     * - Multi-pulse for decision point: [100, 80, 100, 80, 100]
     */
    public getHapticPatternForTurn(decision: NavigationalDecisionPoint | TurnDirection): number[] {
        switch (decision) {
            case 'left':
            case 'slight_left':
                return [...HAPTIC_VIBRATION_PATTERNS.LEFT];
            case 'right':
            case 'slight_right':
                return [...HAPTIC_VIBRATION_PATTERNS.RIGHT];
            case 'destination':
                return [...HAPTIC_VIBRATION_PATTERNS.DESTINATION];
            case 'decision_point':
                return [...HAPTIC_VIBRATION_PATTERNS.DECISION_POINT];
            case 'straight':
            default:
                return [...HAPTIC_VIBRATION_PATTERNS.STRAIGHT];
        }
    }

    /**
     * Checks whether tactile vibration feedback is supported by the current browser environment.
     */
    public isHapticFeedbackSupported(nav?: Navigator): boolean {
        const targetNav = nav || (typeof navigator !== 'undefined' ? navigator : undefined);
        return typeof targetNav !== 'undefined' && typeof targetNav.vibrate === 'function';
    }

    /**
     * Emits distinct haptic vibration turn guidance on supported mobile browsers.
     * Automatically disabled if the browser lacks vibration hardware or user has haptics disabled.
     */
    public emitTactileTurnGuidance(
        decision: NavigationalDecisionPoint | TurnDirection,
        options?: TactileGuidanceOptions
    ): boolean {
        // Disabled if explicitly opted out
        if (options?.enabled === false) {
            return false;
        }

        const nav = options?.navigator || (typeof navigator !== 'undefined' ? navigator : undefined);
        if (!this.isHapticFeedbackSupported(nav)) {
            return false;
        }

        try {
            const pattern = this.getHapticPatternForTurn(decision);
            return nav!.vibrate(pattern);
        } catch {
            return false;
        }
    }

    /**
     * Generates an array of tactile guidance cues for a sequence of path node IDs.
     */
    public generateTactileGuidancePath(
        path: string[],
        options?: TactileGuidanceOptions
    ): TactileGuidanceCue[] {
        if (!path || path.length === 0) return [];

        const cues: TactileGuidanceCue[] = [];

        for (let i = 0; i < path.length - 1; i++) {
            const fromId = path[i];
            const toId = path[i + 1];
            const edge = this.getEdge(fromId, toId);
            const isLast = i === path.length - 2;

            if (isLast) {
                cues.push({
                    decisionPoint: 'destination',
                    turnDirection: 'destination',
                    pattern: [...HAPTIC_VIBRATION_PATTERNS.DESTINATION],
                    instruction: `Arrived at destination (${toId})`,
                    nodeId: toId
                });
            } else if (edge?.turnDirection === 'left') {
                cues.push({
                    decisionPoint: 'left',
                    turnDirection: 'left',
                    pattern: [...HAPTIC_VIBRATION_PATTERNS.LEFT],
                    instruction: `Turn left towards ${toId}`,
                    nodeId: fromId
                });
            } else if (edge?.turnDirection === 'right') {
                cues.push({
                    decisionPoint: 'right',
                    turnDirection: 'right',
                    pattern: [...HAPTIC_VIBRATION_PATTERNS.RIGHT],
                    instruction: `Turn right towards ${toId}`,
                    nodeId: fromId
                });
            } else if (edge?.isSharpCorner) {
                // If sharp corner without explicit turn direction, determine by outgoing edges or default to decision point
                cues.push({
                    decisionPoint: 'decision_point',
                    turnDirection: 'u_turn',
                    pattern: [...HAPTIC_VIBRATION_PATTERNS.DECISION_POINT],
                    instruction: `Sharp turn at ${fromId}`,
                    nodeId: fromId
                });
            }
        }

        return cues;
    }
}
