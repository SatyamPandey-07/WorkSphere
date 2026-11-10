import { ResourceGraph } from './ResourceGraph';

export interface DeadlockCycle {
    tenants: string[];
    victimId: string; // The tenant selected for preemption
}

/**
 * DeadlockDetector implements cycle-detection algorithms to identify 
 * and break circular resource dependencies in the ResourceGraph.
 */
export class DeadlockDetector {
    private graph: ResourceGraph;

    constructor(graph: ResourceGraph) {
        this.graph = graph;
    }

    /**
     * Scans the wait-for graph for circular dependencies.
     * Returns an array of detected deadlock cycles and their recommended victims.
     */
    public detectCycles(): DeadlockCycle[] {
        const cycles: DeadlockCycle[] = [];
        const visited = new Set<string>();
        const recursionStack = new Set<string>();
        const waitEdges = this.graph.getWaitEdges();

        for (const node of waitEdges.keys()) {
            if (!visited.has(node)) {
                const cycle = this.dfs(node, visited, recursionStack, []);
                if (cycle) {
                    cycles.push({
                        tenants: cycle,
                        victimId: this.selectVictim(cycle),
                    });
                }
            }
        }

        return cycles;
    }

    /**
     * Resolves all detected deadlocks by preempting the selected victims.
     */
    public resolveDeadlocks(): DeadlockCycle[] {
        const cycles = this.detectCycles();
        for (const cycle of cycles) {
            this.graph.preemptTenant(cycle.victimId);
        }
        return cycles;
    }

    /**
     * Depth-First Search to find cycles in the directed graph.
     */
    private dfs(
        node: string,
        visited: Set<string>,
        stack: Set<string>,
        path: string[]
    ): string[] | null {
        visited.add(node);
        stack.add(node);
        path.push(node);

        const edges = this.graph.getWaitEdges().get(node) || new Set();
        for (const neighbor of edges) {
            if (!visited.has(neighbor)) {
                const cycle = this.dfs(neighbor, visited, stack, path);
                if (cycle) return cycle;
            } else if (stack.has(neighbor)) {
                // Cycle detected
                const cycleStartIndex = path.indexOf(neighbor);
                return path.slice(cycleStartIndex);
            }
        }

        path.pop();
        stack.delete(node);
        return null;
    }

    /**
     * Selects the optimal victim to preempt from a deadlock cycle.
     * Strategy: Preempt the tenant with the lowest priority.
     * Tie-breaker: Preempt the tenant holding the fewest resources.
     */
    private selectVictim(cycle: string[]): string {
        let victim = cycle[0];
        let lowestPriority = Infinity;

        for (const tenantId of cycle) {
            const tenant = this.graph.getTenant(tenantId);
            if (!tenant) continue;

            if (tenant.priority < lowestPriority) {
                lowestPriority = tenant.priority;
                victim = tenantId;
            }
        }

        return victim;
    }
}
