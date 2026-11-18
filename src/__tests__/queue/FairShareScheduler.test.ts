import {
    FairShareScheduler,
    ScheduledTask,
    TenantQueueConfig
} from '../../core/queue/FairShareScheduler';

describe('FairShareScheduler', () => {
    let scheduler: FairShareScheduler<string>;

    beforeEach(() => {
        scheduler = new FairShareScheduler<string>();
        scheduler.registerTenant({ tenantId: 'tenant-free', tier: 'FREE' }); // quantum: 100, concurrency: 2
        scheduler.registerTenant({ tenantId: 'tenant-pro', tier: 'PRO' });   // quantum: 300, concurrency: 10
        scheduler.registerTenant({ tenantId: 'tenant-ent', tier: 'ENTERPRISE' }); // quantum: 1000, concurrency: 50
    });

    describe('Tenant Registration & Default Parameters', () => {
        it('registers tenants with appropriate default quanta and concurrency', () => {
            const stats = scheduler.getStats();
            expect(stats.activeTenants).toBe(3);
            expect(stats.queuedTasksTotal).toBe(0);
        });

        it('auto-registers unknown tenants with FREE tier defaults upon enqueue', () => {
            scheduler.enqueue({
                id: 'task-unknown-01',
                tenantId: 'tenant-unregistered',
                cost: 50,
                priority: 2,
                payload: 'hello',
                enqueuedAt: Date.now()
            });

            const stats = scheduler.getStats();
            expect(stats.activeTenants).toBe(4);
            expect(scheduler.getQueuedCount('tenant-unregistered')).toBe(1);
        });
    });

    describe('Deficit Round Robin (DRR) Mechanics', () => {
        it('defers tasks when cost exceeds quantum and dispatches when deficit accumulates', () => {
            // Tenant Free has quantum 100. Enqueue a task of cost 160.
            const task: ScheduledTask<string> = {
                id: 'task-heavy-01',
                tenantId: 'tenant-free',
                cost: 160,
                priority: 2,
                payload: 'heavy computation',
                enqueuedAt: Date.now()
            };
            scheduler.enqueue(task);

            // Round 1: Deficit = 100 < 160 -> No tasks dispatched
            const batch1 = scheduler.dispatchNextBatch();
            expect(batch1.length).toBe(0);
            expect(scheduler.getStats().tenantDeficits['tenant-free']).toBe(100);

            // Round 2: Deficit = 100 + 100 = 200 >= 160 -> Task dispatched!
            const batch2 = scheduler.dispatchNextBatch();
            expect(batch2.length).toBe(1);
            expect(batch2[0].id).toBe('task-heavy-01');

            // Complete task to release in-flight slot
            scheduler.completeTask(batch2[0].id, 'tenant-free');

            // Remaining deficit should be 0 because queue became empty
            expect(scheduler.getStats().tenantDeficits['tenant-free']).toBe(0);
        });

        it('zeros out deficit counter when queue is empty to prevent burst hoarding', () => {
            scheduler.enqueue({
                id: 'task-light-01',
                tenantId: 'tenant-pro',
                cost: 50,
                priority: 2,
                payload: 'light task',
                enqueuedAt: Date.now()
            });

            // Pro has quantum 300. Task cost 50.
            const batch = scheduler.dispatchNextBatch();
            expect(batch.length).toBe(1);
            // Queue is now empty, deficit must reset to 0
            expect(scheduler.getStats().tenantDeficits['tenant-pro']).toBe(0);
        });
    });

    describe('Multi-Priority Queuing & Anti-Starvation Aging', () => {
        it('prioritizes P0 tasks over P2 tasks within the same tenant', () => {
            const now = Date.now();
            scheduler.enqueue({
                id: 'task-normal-p2',
                tenantId: 'tenant-ent',
                cost: 50,
                priority: 2,
                payload: 'normal',
                enqueuedAt: now
            });
            scheduler.enqueue({
                id: 'task-critical-p0',
                tenantId: 'tenant-ent',
                cost: 50,
                priority: 0,
                payload: 'critical',
                enqueuedAt: now + 10
            });

            const batch = scheduler.dispatchNextBatch();
            expect(batch.length).toBe(2);
            expect(batch[0].id).toBe('task-critical-p0'); // Dispatched first
            expect(batch[1].id).toBe('task-normal-p2');
        });

        it('escalates priority when SLA maxWaitMs has elapsed', () => {
            const pastTimestamp = Date.now() - 5000;
            scheduler.enqueue({
                id: 'task-starving-p3',
                tenantId: 'tenant-ent',
                cost: 50,
                priority: 3,
                payload: 'starving low priority',
                enqueuedAt: pastTimestamp,
                maxWaitMs: 3000 // 5000 ms elapsed > 3000 ms SLA
            });

            scheduler.enqueue({
                id: 'task-fresh-p1',
                tenantId: 'tenant-ent',
                cost: 50,
                priority: 1,
                payload: 'fresh normal',
                enqueuedAt: Date.now(),
                maxWaitMs: 10000
            });

            const batch = scheduler.dispatchNextBatch();
            expect(batch[0].id).toBe('task-starving-p3'); // Escalate to P0 ahead of fresh P1
        });
    });

    describe('Concurrency Throttling & In-Flight Tracking', () => {
        it('limits concurrent in-flight tasks and releases slots on task completion', () => {
            // Free tier allows max 2 concurrent tasks
            for (let i = 1; i <= 5; i++) {
                scheduler.enqueue({
                    id: `task-free-${i}`,
                    tenantId: 'tenant-free',
                    cost: 30, // 30 * 3 = 90 <= quantum 100
                    priority: 2,
                    payload: `job-${i}`,
                    enqueuedAt: Date.now()
                });
            }

            // Dispatch first batch: should only dispatch 2 tasks due to concurrency limit
            const batch = scheduler.dispatchNextBatch();
            expect(batch.length).toBe(2);
            expect(scheduler.getStats().tenantInFlight['tenant-free']).toBe(2);

            // Attempting to dispatch more should yield 0 while concurrency is maxed
            const batch2 = scheduler.dispatchNextBatch();
            expect(batch2.length).toBe(0);

            // Complete one task
            scheduler.completeTask(batch[0].id, 'tenant-free');
            expect(scheduler.getStats().tenantInFlight['tenant-free']).toBe(1);

            // Now dispatch should be able to grant 1 more task
            const batch3 = scheduler.dispatchNextBatch();
            expect(batch3.length).toBe(1);
        });
    });
});
