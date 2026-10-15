import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

/**
 * API endpoint to initialize resource locks, validate user permissions, 
 * and trigger the deadlock resolution engine via the Web Worker.
 */

// In a real Next.js environment, Web Workers are typically client-side.
// For server-side API routes, we simulate the worker logic or use a worker_threads equivalent.
// Here we implement the core logic directly for the server-side API route.

import { ResourceGraph, Tenant, Resource } from '@/core/resources/ResourceGraph';
import { DeadlockDetector } from '@/core/resources/DeadlockDetector';

// Mock database for resources and tenants
const mockTenants: Tenant[] = [
    { id: 'user_1', priority: 1, name: 'Standard User' },
    { id: 'user_2', priority: 5, name: 'VIP Team' },
];

const mockResources: Resource[] = [
    { id: 'res_3d_printer', name: 'Prusa i3 MK3S+', type: 'printer' },
    { id: 'res_av_cart', name: 'Mobile AV Cart', type: 'av_cart' },
];

const graph = new ResourceGraph();
const detector = new DeadlockDetector(graph);

mockTenants.forEach(t => graph.registerTenant(t));
mockResources.forEach(r => graph.registerResource(r));

export async function POST(req: NextRequest) {
    const { userId } = auth();
    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { resourceId, action } = body;

    if (!resourceId) {
        return NextResponse.json({ error: 'resourceId is required' }, { status: 400 });
    }

    try {
        if (action === 'acquire') {
            const acquired = graph.acquireResource(userId, resourceId);

            // Run deadlock detection
            const cycles = detector.resolveDeadlocks();

            return NextResponse.json({
                success: true,
                acquired,
                deadlocksResolved: cycles.length > 0,
                cycles,
            });
        }

        if (action === 'release') {
            const nextHolder = graph.releaseResource(userId, resourceId);
            return NextResponse.json({
                success: true,
                released: true,
                nextHolder,
            });
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function GET() {
    // Return current graph state for debugging/dashboard
    return NextResponse.json({
        edges: Array.from(graph.getWaitEdges().entries()).map(([k, v]) => [k, Array.from(v)]),
    });
}
