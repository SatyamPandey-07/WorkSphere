/**
 * route.ts
 * API handler to persist the final converged whiteboard state to the database.
 */

import { NextRequest, NextResponse } from 'next/server';
import { CrdtState } from '@/core/crdt/CrdtDocument';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { roomId, state } = body as { roomId: string; state: CrdtState };

        if (!roomId || !state) {
            return NextResponse.json({ error: 'Missing roomId or state' }, { status: 400 });
        }

        // TODO: Integrate with Prisma to save the whiteboard state
        // await prisma.whiteboard.upsert({
        //   where: { roomId },
        //   update: { state: state as unknown as Prisma.InputJsonValue },
        //   create: { roomId, state: state as unknown as Prisma.InputJsonValue }
        // });

        return NextResponse.json({ success: true, message: 'Whiteboard state saved' }, { status: 200 });
    } catch (error) {
        console.error('Error saving whiteboard state:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const roomId = searchParams.get('roomId');

    if (!roomId) {
        return NextResponse.json({ error: 'Missing roomId' }, { status: 400 });
    }

    // TODO: Fetch from Prisma
    // const whiteboard = await prisma.whiteboard.findUnique({ where: { roomId } });

    return NextResponse.json({ success: true, state: null }, { status: 200 });
}
