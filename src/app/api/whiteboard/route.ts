/**
 * route.ts
 * API handler to persist and reconcile converged whiteboard states with monotonic sequence numbering.
 */

import { NextRequest, NextResponse } from 'next/server';
import { CrdtState } from '@/core/crdt/CrdtDocument';
import { getRedis } from '@/lib/redis';
import {
    InMemorySnapshotStorage,
    createRedisSnapshotStorage,
    computeSnapshotChecksum,
    deserializeDelta,
    deserializeSnapshot,
    serializeDelta,
    serializeSnapshot,
    type SerializedDelta,
    type SerializedSnapshot,
    type SnapshotStorage,
    type StoredDelta,
    type StoredSnapshot,
} from '@/lib/crdt/snapshotManager';

interface WhiteboardSnapshot {
    state: CrdtState;
    sequenceNumber: number;
    updatedAt: number;
}

// In-memory snapshot store for rooms and their monotonic sequence numbers
const roomSnapshots = new Map<string, WhiteboardSnapshot>();

// Compacted Yjs snapshots + delta logs (#7574). Redis when configured so
// snapshots survive process restarts; otherwise process-local fallback.
let snapshotStorage: SnapshotStorage | null = null;

function getSnapshotStorage(): SnapshotStorage {
    if (!snapshotStorage) {
        const client = getRedis();
        snapshotStorage = client
            ? createRedisSnapshotStorage(client)
            : new InMemorySnapshotStorage();
    }
    return snapshotStorage;
}

function isSerializedSnapshot(value: unknown): value is SerializedSnapshot {
    if (!value || typeof value !== 'object') return false;
    const snapshot = value as Partial<SerializedSnapshot>;
    return (
        typeof snapshot.roomId === 'string' &&
        typeof snapshot.update === 'string' &&
        typeof snapshot.stateVector === 'string' &&
        typeof snapshot.checksum === 'string' &&
        typeof snapshot.opsAtSnapshot === 'number' &&
        typeof snapshot.createdAt === 'number'
    );
}

function isSerializedDelta(value: unknown): value is SerializedDelta {
    if (!value || typeof value !== 'object') return false;
    const delta = value as Partial<SerializedDelta>;
    return (
        typeof delta.roomId === 'string' &&
        typeof delta.seq === 'number' &&
        typeof delta.update === 'string' &&
        typeof delta.checksum === 'string' &&
        typeof delta.createdAt === 'number'
    );
}

function verifyChecksum(update: Uint8Array, checksum: string): boolean {
    return computeSnapshotChecksum(update) === checksum;
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        if (body.action === 'clear') {
            const { roomId } = body as { roomId?: string };
            if (roomId) {
                roomSnapshots.delete(roomId);
                await getSnapshotStorage().clearRoom(roomId);
            }
            return NextResponse.json({
                success: true,
                message: 'Whiteboard canvas cleared',
                activeTool: 'pen',
                sequenceNumber: 0,
            }, { status: 200 });
        }

        if (body.action === 'snapshot') {
            if (!isSerializedSnapshot(body.snapshot)) {
                return NextResponse.json({ error: 'Invalid snapshot payload' }, { status: 400 });
            }

            const snapshot: StoredSnapshot = deserializeSnapshot(body.snapshot);
            if (!verifyChecksum(snapshot.update, snapshot.checksum)) {
                return NextResponse.json({ error: 'Snapshot checksum mismatch' }, { status: 400 });
            }

            await getSnapshotStorage().saveSnapshot(snapshot);
            return NextResponse.json({
                success: true,
                roomId: snapshot.roomId,
                checksum: snapshot.checksum,
            }, { status: 200 });
        }

        if (body.action === 'delta') {
            if (!isSerializedDelta(body.delta)) {
                return NextResponse.json({ error: 'Invalid delta payload' }, { status: 400 });
            }

            const delta: StoredDelta = deserializeDelta(body.delta);
            if (!verifyChecksum(delta.update, delta.checksum)) {
                return NextResponse.json({ error: 'Delta checksum mismatch' }, { status: 400 });
            }

            await getSnapshotStorage().appendDelta(delta);
            return NextResponse.json({
                success: true,
                roomId: delta.roomId,
                seq: delta.seq,
            }, { status: 200 });
        }

        if (body.action === 'purgeDeltas') {
            const { roomId, throughSeq } = body as {
                roomId?: string;
                throughSeq?: number;
            };
            if (!roomId || typeof throughSeq !== 'number') {
                return NextResponse.json(
                    { error: 'Missing roomId or throughSeq' },
                    { status: 400 },
                );
            }

            await getSnapshotStorage().deleteDeltasThrough(roomId, throughSeq);
            return NextResponse.json({ success: true, roomId, throughSeq }, { status: 200 });
        }

        if (body.action === 'deleteSnapshot') {
            const { roomId } = body as { roomId?: string };
            if (!roomId) {
                return NextResponse.json({ error: 'Missing roomId' }, { status: 400 });
            }

            await getSnapshotStorage().deleteSnapshot(roomId);
            return NextResponse.json({ success: true, roomId }, { status: 200 });
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
    await getSnapshotStorage().clearRoom(roomId);

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

    const action = searchParams.get('action');
    const storage = getSnapshotStorage();

    if (action === 'snapshot') {
        const snapshot = await storage.loadSnapshot(roomId);
        return NextResponse.json({
            success: true,
            roomId,
            snapshot: snapshot ? serializeSnapshot(snapshot) : null,
        }, { status: 200 });
    }

    if (action === 'deltas') {
        const deltas = await storage.listDeltas(roomId);
        return NextResponse.json({
            success: true,
            roomId,
            deltas: deltas.map(serializeDelta),
        }, { status: 200 });
    }

    if (action === 'recover') {
        const [snapshot, deltas] = await Promise.all([
            storage.loadSnapshot(roomId),
            storage.listDeltas(roomId),
        ]);
        return NextResponse.json({
            success: true,
            roomId,
            snapshot: snapshot ? serializeSnapshot(snapshot) : null,
            deltas: deltas.map(serializeDelta),
        }, { status: 200 });
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
