/**
 * route.ts
 * API handler to persist and reconcile converged whiteboard states with monotonic sequence numbering.
 * Enforces Clerk authentication, room-level authorization, and strict pre-authorization
 * payload validation (#10364, #10452).
 *
 * Why payload validation must precede authorization (#10452):
 * 1. Denial-of-Service (DoS) and Resource Protection:
 *    Authorization checks typically involve external service roundtrips (Clerk session verification)
 *    and database/cache queries (checking `FolderMember` or `Folder` ownership in Prisma/Redis).
 *    Invoking authorization for malformed, oversized, or missing payloads forces expensive I/O and
 *    session lookups for requests that can never succeed anyway.
 * 2. Defense-in-Depth & Fail-Fast:
 *    Parsing and rejecting structurally invalid, corrupted, or oversized payloads with HTTP 400
 *    ensures that malformed input never reaches authorization handlers, database queries, or
 *    snapshot persistence logic.
 * 3. Consistent Error Semantics:
 *    Clients sending invalid JSON or missing required fields should immediately receive standard
 *    HTTP 400 Bad Request responses rather than confusing 401 Unauthorized or 403 Forbidden errors.
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
import {
    authorizeRoomOperation,
    type RoomOperationType,
} from '@/lib/whiteboard/whiteboardAuthorization';

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

/** Maximum allowed base64 / string size for snapshot updates (10MB) */
export const MAX_SNAPSHOT_PAYLOAD_BYTES = 10 * 1024 * 1024;
/** Maximum allowed room ID length */
export const MAX_ROOM_ID_LENGTH = 256;
/** Maximum allowed sequence number */
export const MAX_SEQUENCE_NUMBER = Number.MAX_SAFE_INTEGER;

/**
 * Validates a room identifier's type, non-emptiness, and bounds.
 */
export function isValidRoomId(roomId: unknown): roomId is string {
    return (
        typeof roomId === 'string' &&
        roomId.trim().length > 0 &&
        roomId.length <= MAX_ROOM_ID_LENGTH
    );
}

/**
 * Validates serialized snapshot payload structure, types, and bounds.
 */
export function isSerializedSnapshot(value: unknown): value is SerializedSnapshot {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const snapshot = value as Partial<SerializedSnapshot>;
    return (
        isValidRoomId(snapshot.roomId) &&
        typeof snapshot.update === 'string' &&
        snapshot.update.length > 0 &&
        snapshot.update.length <= MAX_SNAPSHOT_PAYLOAD_BYTES &&
        typeof snapshot.stateVector === 'string' &&
        snapshot.stateVector.length > 0 &&
        snapshot.stateVector.length <= MAX_SNAPSHOT_PAYLOAD_BYTES &&
        typeof snapshot.checksum === 'string' &&
        snapshot.checksum.trim().length > 0 &&
        typeof snapshot.opsAtSnapshot === 'number' &&
        Number.isFinite(snapshot.opsAtSnapshot) &&
        snapshot.opsAtSnapshot >= 0 &&
        typeof snapshot.createdAt === 'number' &&
        Number.isFinite(snapshot.createdAt) &&
        snapshot.createdAt > 0
    );
}

/**
 * Validates serialized delta payload structure, types, and bounds.
 */
export function isSerializedDelta(value: unknown): value is SerializedDelta {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const delta = value as Partial<SerializedDelta>;
    return (
        isValidRoomId(delta.roomId) &&
        typeof delta.seq === 'number' &&
        Number.isFinite(delta.seq) &&
        delta.seq >= 0 &&
        delta.seq <= MAX_SEQUENCE_NUMBER &&
        typeof delta.update === 'string' &&
        delta.update.length > 0 &&
        delta.update.length <= MAX_SNAPSHOT_PAYLOAD_BYTES &&
        typeof delta.checksum === 'string' &&
        delta.checksum.trim().length > 0 &&
        typeof delta.createdAt === 'number' &&
        Number.isFinite(delta.createdAt) &&
        delta.createdAt > 0
    );
}

function verifyChecksum(update: Uint8Array, checksum: string): boolean {
    return computeSnapshotChecksum(update) === checksum;
}

/**
 * Validates request authorization for a room and required permission tier.
 */
async function enforceAuth(
    request: NextRequest,
    roomId: string,
    operation: RoomOperationType,
): Promise<NextResponse | null> {
    const authResult = await authorizeRoomOperation(request, roomId, operation);
    if (!authResult.authorized) {
        return NextResponse.json(
            { error: authResult.error || 'Forbidden' },
            { status: authResult.statusCode || 403 },
        );
    }
    return null;
}

export async function POST(request: NextRequest) {
    try {
        let body: any;
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
        }

        // Structural validation: reject null, non-objects, or arrays as root body
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
        }

        // 1. Room-state clearing (destructive / delete operation)
        if (body.action === 'clear') {
            const { roomId } = body as { roomId?: unknown };
            // PRE-AUTH VALIDATION
            if (!isValidRoomId(roomId)) {
                return NextResponse.json({ error: 'Missing or invalid roomId' }, { status: 400 });
            }

            // AUTHORIZATION ENFORCEMENT
            const authErr = await enforceAuth(request, roomId, 'delete');
            if (authErr) return authErr;

            roomSnapshots.delete(roomId);
            await getSnapshotStorage().clearRoom(roomId);

            return NextResponse.json({
                success: true,
                message: 'Whiteboard canvas cleared',
                activeTool: 'pen',
                sequenceNumber: 0,
            }, { status: 200 });
        }

        // 2. Snapshot creation (write operation)
        if (body.action === 'snapshot') {
            // PRE-AUTH VALIDATION: Validate structure, required fields, and array/size bounds
            if (!isSerializedSnapshot(body.snapshot)) {
                return NextResponse.json({ error: 'Invalid snapshot payload' }, { status: 400 });
            }

            let snapshot: StoredSnapshot;
            try {
                snapshot = deserializeSnapshot(body.snapshot);
            } catch {
                return NextResponse.json({ error: 'Malformed snapshot encoding' }, { status: 400 });
            }

            if (!isValidRoomId(snapshot.roomId)) {
                return NextResponse.json({ error: 'Missing or invalid roomId in snapshot' }, { status: 400 });
            }

            if (!verifyChecksum(snapshot.update, snapshot.checksum)) {
                return NextResponse.json({ error: 'Snapshot checksum mismatch' }, { status: 400 });
            }

            // AUTHORIZATION ENFORCEMENT
            const authErr = await enforceAuth(request, snapshot.roomId, 'write');
            if (authErr) return authErr;

            await getSnapshotStorage().saveSnapshot(snapshot);
            return NextResponse.json({
                success: true,
                roomId: snapshot.roomId,
                checksum: snapshot.checksum,
            }, { status: 200 });
        }

        // 3. Delta insertion (write operation)
        if (body.action === 'delta') {
            // PRE-AUTH VALIDATION
            if (!isSerializedDelta(body.delta)) {
                return NextResponse.json({ error: 'Invalid delta payload' }, { status: 400 });
            }

            let delta: StoredDelta;
            try {
                delta = deserializeDelta(body.delta);
            } catch {
                return NextResponse.json({ error: 'Malformed delta encoding' }, { status: 400 });
            }

            if (!isValidRoomId(delta.roomId)) {
                return NextResponse.json({ error: 'Missing or invalid roomId in delta' }, { status: 400 });
            }

            if (!verifyChecksum(delta.update, delta.checksum)) {
                return NextResponse.json({ error: 'Delta checksum mismatch' }, { status: 400 });
            }

            // AUTHORIZATION ENFORCEMENT
            const authErr = await enforceAuth(request, delta.roomId, 'write');
            if (authErr) return authErr;

            await getSnapshotStorage().appendDelta(delta);
            return NextResponse.json({
                success: true,
                roomId: delta.roomId,
                seq: delta.seq,
            }, { status: 200 });
        }

        // 4. Delta cleanup / purge (destructive / delete operation)
        if (body.action === 'purgeDeltas') {
            const { roomId, throughSeq } = body as {
                roomId?: unknown;
                throughSeq?: unknown;
            };

            // PRE-AUTH VALIDATION
            if (!isValidRoomId(roomId) || typeof throughSeq !== 'number' || !Number.isFinite(throughSeq) || throughSeq < 0) {
                return NextResponse.json(
                    { error: 'Missing or invalid roomId or throughSeq' },
                    { status: 400 },
                );
            }

            // AUTHORIZATION ENFORCEMENT
            const authErr = await enforceAuth(request, roomId, 'delete');
            if (authErr) return authErr;

            await getSnapshotStorage().deleteDeltasThrough(roomId, throughSeq);
            return NextResponse.json({ success: true, roomId, throughSeq }, { status: 200 });
        }

        // 5. Snapshot deletion (destructive / delete operation)
        if (body.action === 'deleteSnapshot') {
            const { roomId } = body as { roomId?: unknown };

            // PRE-AUTH VALIDATION
            if (!isValidRoomId(roomId)) {
                return NextResponse.json({ error: 'Missing or invalid roomId' }, { status: 400 });
            }

            // AUTHORIZATION ENFORCEMENT
            const authErr = await enforceAuth(request, roomId, 'delete');
            if (authErr) return authErr;

            await getSnapshotStorage().deleteSnapshot(roomId);
            return NextResponse.json({ success: true, roomId }, { status: 200 });
        }

        // 6. Direct state persistence (write operation)
        const { roomId, state, sequenceNumber } = body as {
            roomId?: unknown;
            state?: unknown;
            sequenceNumber?: unknown;
        };

        // PRE-AUTH VALIDATION
        if (!isValidRoomId(roomId) || !state || typeof state !== 'object') {
            return NextResponse.json({ error: 'Missing or invalid roomId or state' }, { status: 400 });
        }

        if (sequenceNumber !== undefined && (typeof sequenceNumber !== 'number' || !Number.isFinite(sequenceNumber) || sequenceNumber < 0)) {
            return NextResponse.json({ error: 'Invalid sequenceNumber' }, { status: 400 });
        }

        // AUTHORIZATION ENFORCEMENT
        const authErr = await enforceAuth(request, roomId, 'write');
        if (authErr) return authErr;

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
            state: state as CrdtState,
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

// Operation 7: Room-state deletion via DELETE (destructive / delete operation)
export async function DELETE(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const roomId = searchParams.get('roomId');

    // PRE-AUTH VALIDATION
    if (!isValidRoomId(roomId)) {
        return NextResponse.json({ error: 'Missing or invalid roomId' }, { status: 400 });
    }

    // AUTHORIZATION ENFORCEMENT
    const authErr = await enforceAuth(request, roomId, 'delete');
    if (authErr) return authErr;

    roomSnapshots.delete(roomId);
    await getSnapshotStorage().clearRoom(roomId);

    return NextResponse.json({
        success: true,
        message: 'Whiteboard canvas cleared',
        activeTool: 'pen',
        sequenceNumber: 0,
    }, { status: 200 });
}

// Operation 1: Snapshot retrieval and inspection (read operation)
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const roomId = searchParams.get('roomId');

    // PRE-AUTH VALIDATION
    if (!isValidRoomId(roomId)) {
        return NextResponse.json({ error: 'Missing or invalid roomId' }, { status: 400 });
    }

    // AUTHORIZATION ENFORCEMENT
    const authErr = await enforceAuth(request, roomId, 'read');
    if (authErr) return authErr;

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
