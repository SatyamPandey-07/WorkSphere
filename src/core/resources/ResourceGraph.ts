/**
 * ResourceGraph manages the directed wait-for graph representing active locks
 * and pending resource requests in a multi-tenant workspace environment.
 */

export interface Tenant {
    id: string;
    priority: number; // Higher number = higher priority (e.g., VIP or critical team)
    name: string;
}

export interface Resource {
    id: string;
    name: string;
    type: 'printer' | 'av_cart' | 'phone_booth' | 'meeting_room';
}

export interface LockState {
    resourceId: string;
    holderId: string | null;
    waitQueue: string[]; // Ordered list of tenant IDs waiting for this resource
}

export class ResourceGraph {
    // Adjacency list: tenantId -> Set of tenantIds they are waiting for
    private waitEdges: Map<string, Set<string>>;
    // Map of resourceId -> LockState
    private resources: Map<string, LockState>;
    // Map of tenantId -> Tenant metadata
    private tenants: Map<string, Tenant>;

    constructor() {
        this.waitEdges = new Map();
        this.resources = new Map();
        this.tenants = new Map();
    }

    public registerTenant(tenant: Tenant): void {
        this.tenants.set(tenant.id, tenant);
        if (!this.waitEdges.has(tenant.id)) {
            this.waitEdges.set(tenant.id, new Set());
        }
    }

    public registerResource(resource: Resource): void {
        if (!this.resources.has(resource.id)) {
            this.resources.set(resource.id, {
                resourceId: resource.id,
                holderId: null,
                waitQueue: [],
            });
        }
    }

    public getTenant(tenantId: string): Tenant | undefined {
        return this.tenants.get(tenantId);
    }

    /**
     * Attempts to acquire a resource immediately if available.
     * Returns true if acquired, false if added to wait queue.
     */
    public acquireResource(tenantId: string, resourceId: string): boolean {
        const resource = this.resources.get(resourceId);
        if (!resource) throw new Error(`Resource ${resourceId} not found`);
        if (!this.tenants.has(tenantId)) throw new Error(`Tenant ${tenantId} not registered`);

        if (resource.holderId === null) {
            resource.holderId = tenantId;
            return true;
        }

        // Resource is held, add to wait queue and update wait-for graph
        if (!resource.waitQueue.includes(tenantId)) {
            resource.waitQueue.push(tenantId);
            this.updateWaitEdges(resourceId);
        }
        return false;
    }

    /**
     * Releases a resource and grants it to the next tenant in the queue.
     * Returns the ID of the newly granted tenant, or null if queue is empty.
     */
    public releaseResource(tenantId: string, resourceId: string): string | null {
        const resource = this.resources.get(resourceId);
        if (!resource || resource.holderId !== tenantId) return null;

        resource.holderId = null;
        this.clearWaitEdgesForTenant(tenantId);

        if (resource.waitQueue.length > 0) {
            const nextTenant = resource.waitQueue.shift()!;
            resource.holderId = nextTenant;
            this.updateWaitEdges(resourceId);
            return nextTenant;
        }
        return null;
    }

    /**
     * Preempts a tenant, forcing them to release all held resources.
     * Used by the DeadlockDetector to break circular dependencies.
     */
    public preemptTenant(tenantId: string): void {
        this.clearWaitEdgesForTenant(tenantId);

        // Release all resources held by the preempted tenant
        for (const [resId, state] of this.resources.entries()) {
            if (state.holderId === tenantId) {
                state.holderId = null;
                if (state.waitQueue.length > 0) {
                    const nextTenant = state.waitQueue.shift()!;
                    state.holderId = nextTenant;
                    this.updateWaitEdges(resId);
                }
            }
            // Remove from any wait queues
            state.waitQueue = state.waitQueue.filter(id => id !== tenantId);
        }
    }

    public getWaitEdges(): Map<string, Set<string>> {
        return this.waitEdges;
    }

    private updateWaitEdges(resourceId: string): void {
        const resource = this.resources.get(resourceId)!;
        if (!resource.holderId) return;

        for (const waiterId of resource.waitQueue) {
            const edges = this.waitEdges.get(waiterId);
            if (edges) {
                edges.add(resource.holderId);
            }
        }
    }

    private clearWaitEdgesForTenant(tenantId: string): void {
        // Remove outgoing edges (tenant is no longer waiting)
        this.waitEdges.set(tenantId, new Set());

        // Remove incoming edges (other tenants are no longer waiting for this tenant)
        for (const edges of this.waitEdges.values()) {
            edges.delete(tenantId);
        }
    }
}
