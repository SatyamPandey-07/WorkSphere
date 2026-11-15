/**
 * Web Worker that evaluates complex multi-tenant booking matrices 
 * off the main thread to prevent UI blocking during deadlock resolution.
 */

import { ResourceGraph, Tenant, Resource } from '../core/resources/ResourceGraph';
import { DeadlockDetector } from '../core/resources/DeadlockDetector';

interface WorkerMessage {
    type: 'INIT' | 'REQUEST_LOCK' | 'RELEASE_LOCK';
    payload: any;
}

interface WorkerResponse {
    type: 'LOCK_GRANTED' | 'LOCK_QUEUED' | 'DEADLOCK_RESOLVED' | 'ERROR';
    payload: any;
}

let graph: ResourceGraph;
let detector: DeadlockDetector;

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const { type, payload } = event.data;

    try {
        switch (type) {
            case 'INIT':
                graph = new ResourceGraph();
                detector = new DeadlockDetector(graph);

                // Register initial tenants and resources
                payload.tenants.forEach((t: Tenant) => graph.registerTenant(t));
                payload.resources.forEach((r: Resource) => graph.registerResource(r));

                respond({ type: 'LOCK_GRANTED', payload: { status: 'initialized' } });
                break;

            case 'REQUEST_LOCK':
                const { tenantId, resourceId } = payload;
                const acquired = graph.acquireResource(tenantId, resourceId);

                if (acquired) {
                    respond({ type: 'LOCK_GRANTED', payload: { tenantId, resourceId } });
                } else {
                    respond({ type: 'LOCK_QUEUED', payload: { tenantId, resourceId } });
                }

                // Check for deadlocks after every request
                const cycles = detector.resolveDeadlocks();
                if (cycles.length > 0) {
                    respond({
                        type: 'DEADLOCK_RESOLVED',
                        payload: { cycles, timestamp: Date.now() }
                    });
                }
                break;

            case 'RELEASE_LOCK':
                const { tenantId: relTenant, resourceId: relResource } = payload;
                const nextHolder = graph.releaseResource(relTenant, relResource);

                if (nextHolder) {
                    respond({ type: 'LOCK_GRANTED', payload: { tenantId: nextHolder, resourceId: relResource } });
                }
                break;

            default:
                respond({ type: 'ERROR', payload: { message: 'Unknown message type' } });
        }
    } catch (error: any) {
        respond({ type: 'ERROR', payload: { message: error.message } });
    }
};

function respond(message: WorkerResponse) {
    self.postMessage(message);
}
