/**
 * route.ts
 * API handler to persist and reconcile converged whiteboard states with monotonic sequence numbering.
 */

import { NextRequest, NextResponse } from 'next/server';
import { CrdtState } from '@/core/crdt/CrdtDocument';

interface WhiteboardSnapshot {
    state: CrdtState;
    sequenceNumber: number;
    updatedAt: number;
}

// In-memory snapshot store for rooms and their monotonic sequence numbers
const roomSnapshots = new Map<string, WhiteboardSnapshot>();

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        if (body.action === 'clear') {
            const { roomId } = body as { roomId?: string };
            if (roomId) {
                roomSnapshots.delete(roomId);
            }
            return NextResponse.json({
                success: true,
                message: 'Whiteboard canvas cleared',
                activeTool: 'pen',
                sequenceNumber: 0,
            }, { status: 200 });
        }

        const { roomId, state, sequenceNumber } = body as {
            roomId: string;
            state: CrdtState;
            sequenceNumber?: number;
        };

        if (!roomId || !state) {
            return NextResponse.json({ error: 'Missing roomId or state' }, { status: 400 });
        }

        const existing = roomSnapshots.get(roomId);
        const incomingSeq = typeof sequenceNumber === 'number' ? sequenceNumber : (existing?.sequenceNumber ?? 0) + 1;

        // Reject out-of-order stale updates if incoming sequence is strictly lower than existing
        if (existing && typeof sequenceNumber === 'number' && sequenceNumber < existing.sequenceNumber) {
            return NextResponse.json({
                error: 'Stale sequence update',
                currentSequence: existing.sequenceNumber,
                receivedSequence: sequenceNumber,
            }, { status: 409 });
        }

        roomSnapshots.set(roomId, {
            state,
            sequenceNumber: incomingSeq,
            updatedAt: Date.now(),
        });

        return NextResponse.json({
            success: true,
            message: 'Whiteboard state saved',
            roomId,
            sequenceNumber: incomingSeq,
        }, { status: 200 });
    } catch (error) {
        console.error('Error saving whiteboard state:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const roomId = searchParams.get('roomId');

    if (!roomId) {
        return NextResponse.json({ error: 'Missing roomId' }, { status: 400 });
    }

    roomSnapshots.delete(roomId);

    return NextResponse.json({
        success: true,
        message: 'Whiteboard canvas cleared',
        activeTool: 'pen',
        sequenceNumber: 0,
    }, { status: 200 });
}

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const roomId = searchParams.get('roomId');

    if (!roomId) {
        return NextResponse.json({ error: 'Missing roomId' }, { status: 400 });
    }

    const snapshot = roomSnapshots.get(roomId);

    return NextResponse.json({
        success: true,
        roomId,
        state: snapshot ? snapshot.state : null,
        sequenceNumber: snapshot ? snapshot.sequenceNumber : 0,
        updatedAt: snapshot ? snapshot.updatedAt : null,
    }, { status: 200 });
}
