import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { LamportTimestampResolver, MutationPayload } from '@/core/sync/LamportTimestampResolver';
import { VectorClock } from '@/core/sync/VectorClock';

/**
 * API endpoint that accepts batched vector clock updates, resolves 
 * server-side conflicts, and returns the unified state delta.
 */

// Mock server-side database state
const serverState: Record<string, any> = {};
const serverClock = new VectorClock('server');

export async function POST(req: NextRequest) {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { mutations, clientClock } = body;

        if (!Array.isArray(mutations)) {
            return NextResponse.json({ error: 'Invalid mutations payload' }, { status: 400 });
        }

        // Merge client clock into server clock
        serverClock.merge(clientClock || {});

        // Process mutations
        const result = LamportTimestampResolver.replayMutations(
            serverState,
            serverClock.getClock(),
            mutations as MutationPayload[],
            'server'
        );

        // Update server state
        Object.assign(serverState, result.state);
        serverClock.merge(result.clock);

        return NextResponse.json({
            success: true,
            acceptedCount: mutations.length,
            newServerClock: serverClock.getClock(),
            stateDelta: result.state, // In production, calculate actual diff
        });

    } catch (error: any) {
        console.error('[Sync API] Resolution failed:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
