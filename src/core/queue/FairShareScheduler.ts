/**
 * @file FairShareScheduler.ts
 * @description Enterprise multi-tenant Deficit Round Robin (DRR) and priority
 * fair-share task scheduler. Manages tenant quantum credits, dual-dimension priority
 * queues, SLA anti-starvation age escalation, and per-tenant concurrency backpressure.
 */

export type TenantTier = 'FREE' | 'PRO' | 'ENTERPRISE';
export type TaskPriority = 0 | 1 | 2 | 3; // 0 = P0_CRITICAL, 1 = P1_HIGH, 2 = P2_NORMAL, 3 = P3_LOW

export interface ScheduledTask<T = any> {
    id: string;
    tenantId: string;
    cost: number;               // Execution weight/resource cost (e.g. 50 units)
    priority: TaskPriority;
    payload: T;
    enqueuedAt: number;         // Timestamp
    maxWaitMs?: number;         // SLA deadline in ms
}

export interface TenantQueueConfig {
    tenantId: string;
    tier: TenantTier;
    quantum?: number;           // Per-round DRR credit allocation
    maxConcurrentTasks?: number;
}

export interface SchedulerStats {
    totalDispatched: number;
    activeTenants: number;
    queuedTasksTotal: number;
    inFlightTotal: number;
    tenantDeficits: Record<string, number>;
    tenantInFlight: Record<string, number>;
}

export class FairShareScheduler<T = any> {
    // Default tier quanta (cost credits granted per round)
    public static readonly TIER_DEFAULT_QUANTA: Record<TenantTier, number> = {
        FREE: 100,
        PRO: 300,
        ENTERPRISE: 1000
    };

    // Default concurrent task ceilings per tier
    public static readonly TIER_DEFAULT_CONCURRENCY: Record<TenantTier, number> = {
        FREE: 2,
        PRO: 10,
        ENTERPRISE: 50
    };

    private tenantConfigs: Map<string, TenantQueueConfig> = new Map();
    private tenantQueues: Map<string, ScheduledTask<T>[]> = new Map();
    private tenantDeficits: Map<string, number> = new Map();
    private tenantInFlight: Map<string, number> = new Map();
    private tenantOrder: string[] = [];
    private currentRoundRobinIndex: number = 0;
    private totalDispatchedCount: number = 0;

    constructor() {}

    /**
     * Registers a tenant with tier and concurrency parameters.
     */
    public registerTenant(config: TenantQueueConfig): void {
        const effectiveConfig: TenantQueueConfig = {
            quantum: FairShareScheduler.TIER_DEFAULT_QUANTA[config.tier],
            maxConcurrentTasks: FairShareScheduler.TIER_DEFAULT_CONCURRENCY[config.tier],
            ...config
        };

        this.tenantConfigs.set(config.tenantId, effectiveConfig);
        if (!this.tenantQueues.has(config.tenantId)) {
            this.tenantQueues.set(config.tenantId, []);
            this.tenantDeficits.set(config.tenantId, 0);
            this.tenantInFlight.set(config.tenantId, 0);
            this.tenantOrder.push(config.tenantId);
        }
    }

    /**
     * Enqueues a task into the corresponding tenant's queue.
     */
    public enqueue(task: ScheduledTask<T>): void {
        if (!this.tenantConfigs.has(task.tenantId)) {
            // Auto-register unregistered tenants under FREE tier
            this.registerTenant({ tenantId: task.tenantId, tier: 'FREE' });
        }

        const queue = this.tenantQueues.get(task.tenantId)!;
        queue.push({ ...task });
        this.sortTenantQueue(queue);
    }

    /**
     * Enqueues multiple tasks.
     */
    public enqueueBatch(tasks: ScheduledTask<T>[]): void {
        for (const task of tasks) {
            this.enqueue(task);
        }
    }

    /**
     * Sorts tenant queue by effective priority (with SLA aging anti-starvation boost).
     */
    private sortTenantQueue(queue: ScheduledTask<T>[]): void {
        const now = Date.now();

        queue.sort((a, b) => {
            const effA = this.getEffectivePriority(a, now);
            const effB = this.getEffectivePriority(b, now);

            if (effA !== effB) {
                return effA - effB; // Lower numeric value = higher priority
            }
            return a.enqueuedAt - b.enqueuedAt; // FIFO within same priority
        });
    }

    /**
     * Computes dynamic effective priority with anti-starvation age escalation.
     */
    private getEffectivePriority(task: ScheduledTask<T>, now: number): number {
        if (!task.maxWaitMs || task.priority === 0) {
            return task.priority;
        }

        const age = now - task.enqueuedAt;
        if (age >= task.maxWaitMs) {
            // Escalate to P0 if SLA has lapsed
            return 0;
        }
        if (age >= task.maxWaitMs * 0.5 && task.priority > 1) {
            // Escalate by 1 level if half SLA has lapsed
            return task.priority - 1;
        }

        return task.priority;
    }

    /**
     * Dispatches tasks using Deficit Round Robin (DRR) over all active tenant queues.
     */
    public dispatchNextBatch(maxBatchCost: number = 2000): ScheduledTask<T>[] {
        const dispatched: ScheduledTask<T>[] = [];
        let accumulatedBatchCost = 0;

        if (this.tenantOrder.length === 0) return dispatched;

        const startIdx = this.currentRoundRobinIndex;
        let visitedTenants = 0;

        while (visitedTenants < this.tenantOrder.length && accumulatedBatchCost < maxBatchCost) {
            const tenantId = this.tenantOrder[this.currentRoundRobinIndex];
            const config = this.tenantConfigs.get(tenantId)!;
            const queue = this.tenantQueues.get(tenantId)!;
            const currentInFlight = this.tenantInFlight.get(tenantId) || 0;
            const maxConcurrent = config.maxConcurrentTasks ?? 10;

            if (queue.length > 0 && currentInFlight < maxConcurrent) {
                // Add quantum to deficit counter
                const currentDeficit = (this.tenantDeficits.get(tenantId) || 0) + (config.quantum || 100);
                let remainingDeficit = currentDeficit;

                // Re-sort to account for elapsed wait times
                this.sortTenantQueue(queue);

                while (queue.length > 0 && (this.tenantInFlight.get(tenantId) || 0) < maxConcurrent) {
                    const nextTask = queue[0];

                    if (nextTask.cost <= remainingDeficit) {
                        if (accumulatedBatchCost + nextTask.cost > maxBatchCost && dispatched.length > 0) {
                            // Reached global batch capacity
                            break;
                        }

                        // Dequeue task
                        queue.shift();
                        remainingDeficit -= nextTask.cost;
                        accumulatedBatchCost += nextTask.cost;

                        // Increment in-flight
                        const newInFlight = (this.tenantInFlight.get(tenantId) || 0) + 1;
                        this.tenantInFlight.set(tenantId, newInFlight);

                        dispatched.push(nextTask);
                        this.totalDispatchedCount++;
                    } else {
                        // Task cost exceeds current deficit, defer to next round
                        break;
                    }
                }

                // If queue became empty, zero out deficit to prevent idle hoarding
                if (queue.length === 0) {
                    this.tenantDeficits.set(tenantId, 0);
                } else {
                    this.tenantDeficits.set(tenantId, remainingDeficit);
                }
            } else if (queue.length === 0) {
                // Empty queue has zero deficit
                this.tenantDeficits.set(tenantId, 0);
            }

            // Move round-robin pointer
            this.currentRoundRobinIndex = (this.currentRoundRobinIndex + 1) % this.tenantOrder.length;
            visitedTenants++;
        }

        return dispatched;
    }

    /**
     * Signals task completion, clearing in-flight concurrency slots for the tenant.
     */
    public completeTask(taskId: string, tenantId: string): void {
        const inFlight = this.tenantInFlight.get(tenantId) || 0;
        if (inFlight > 0) {
            this.tenantInFlight.set(tenantId, inFlight - 1);
        }
    }

    /**
     * Returns queued tasks count for a specific tenant.
     */
    public getQueuedCount(tenantId: string): number {
        return this.tenantQueues.get(tenantId)?.length || 0;
    }

    /**
     * Returns current operational telemetry and statistics.
     */
    public getStats(): SchedulerStats {
        let queuedTotal = 0;
        let inFlightTotal = 0;
        const tenantDeficits: Record<string, number> = {};
        const tenantInFlight: Record<string, number> = {};

        for (const [id, q] of this.tenantQueues.entries()) {
            queuedTotal += q.length;
        }
        for (const [id, count] of this.tenantInFlight.entries()) {
            inFlightTotal += count;
            tenantInFlight[id] = count;
        }
        for (const [id, def] of this.tenantDeficits.entries()) {
            tenantDeficits[id] = def;
        }

        return {
            totalDispatched: this.totalDispatchedCount,
            activeTenants: this.tenantOrder.length,
            queuedTasksTotal: queuedTotal,
            inFlightTotal,
            tenantDeficits,
            tenantInFlight
        };
    }
}
