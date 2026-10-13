/**
 * EquipmentInventoryGraph.ts
 * Manages the directed graph of venue equipment, tracking rental states, 
 * maintenance cycles, and availability.
 */

export enum EquipmentState {
    AVAILABLE = 'AVAILABLE',
    RENTED = 'RENTED',
    MAINTENANCE = 'MAINTENANCE',
    RETIRED = 'RETIRED',
}

export interface EquipmentNode {
    id: string;
    name: string;
    type: string;
    state: EquipmentState;
    locationId: string;
    lockerId?: string;
    metadata: Record<string, any>;
}

export interface EquipmentEdge {
    fromId: string;
    toId: string;
    relation: 'DEPENDS_ON' | 'LOCATED_NEAR' | 'ALTERNATIVE_TO';
}

export class EquipmentInventoryGraph {
    private nodes: Map<string, EquipmentNode> = new Map();
    private adjacencyList: Map<string, Set<string>> = new Map();
    private reverseAdjacencyList: Map<string, Set<string>> = new Map();

    public addNode(node: EquipmentNode): void {
        this.nodes.set(node.id, node);
        if (!this.adjacencyList.has(node.id)) {
            this.adjacencyList.set(node.id, new Set());
        }
        if (!this.reverseAdjacencyList.has(node.id)) {
            this.reverseAdjacencyList.set(node.id, new Set());
        }
    }

    public addEdge(edge: EquipmentEdge): void {
        if (!this.nodes.has(edge.fromId) || !this.nodes.has(edge.toId)) {
            throw new Error('Cannot add edge between non-existent nodes');
        }

        this.adjacencyList.get(edge.fromId)!.add(edge.toId);
        this.reverseAdjacencyList.get(edge.toId)!.add(edge.fromId);
    }

    public getNode(id: string): EquipmentNode | undefined {
        return this.nodes.get(id);
    }

    public updateState(id: string, newState: EquipmentState): void {
        const node = this.nodes.get(id);
        if (!node) {
            throw new Error(`Equipment ${id} not found`);
        }
        node.state = newState;
    }

    public findAvailableByType(type: string, locationId: string): EquipmentNode[] {
        const results: EquipmentNode[] = [];
        for (const node of this.nodes.values()) {
            if (
                node.type === type &&
                node.locationId === locationId &&
                node.state === EquipmentState.AVAILABLE
            ) {
                results.push(node);
            }
        }
        return results;
    }

    public getAlternatives(id: string): EquipmentNode[] {
        const alternatives: EquipmentNode[] = [];
        const neighbors = this.adjacencyList.get(id);
        if (!neighbors) return alternatives;

        for (const neighborId of neighbors) {
            const node = this.nodes.get(neighborId);
            if (node && node.state === EquipmentState.AVAILABLE) {
                // Check if the edge relation is ALTERNATIVE_TO
                // In a full implementation, we'd store edge metadata. 
                // For now, we assume neighbors of same type are alternatives.
                const sourceNode = this.nodes.get(id);
                if (sourceNode && sourceNode.type === node.type) {
                    alternatives.push(node);
                }
            }
        }
        return alternatives;
    }

    public getDependencies(id: string): EquipmentNode[] {
        const dependencies: EquipmentNode[] = [];
        const parents = this.reverseAdjacencyList.get(id);
        if (!parents) return dependencies;

        for (const parentId of parents) {
            const node = this.nodes.get(parentId);
            if (node) {
                dependencies.push(node);
            }
        }
        return dependencies;
    }

    public getGraphStats(): { total: number; available: number; rented: number; maintenance: number } {
        let available = 0, rented = 0, maintenance = 0;
        for (const node of this.nodes.values()) {
            if (node.state === EquipmentState.AVAILABLE) available++;
            else if (node.state === EquipmentState.RENTED) rented++;
            else if (node.state === EquipmentState.MAINTENANCE) maintenance++;
        }
        return {
            total: this.nodes.size,
            available,
            rented,
            maintenance,
        };
    }
}
