import VenuePresenceRoom, {
    HEARTBEAT_PING_INTERVAL_MS,
    HEARTBEAT_TIMEOUT_MS,
} from '../../../party/venueRoom';
import type * as Party from 'partykit/server';

function createMockConnection(id: string) {
    return {
        id,
        send: jest.fn(),
        close: jest.fn(),
    } as unknown as Party.Connection & {
        send: jest.Mock;
        close: jest.Mock;
    };
}

function createMockRoom(id = 'venue-bavdhan-01') {
    const connections = new Map<string, Party.Connection>();
    const broadcast = jest.fn((msg: string, without?: string[]) => {
        const excluded = new Set(without ?? []);
        for (const [connId, conn] of connections.entries()) {
            if (!excluded.has(connId)) {
                conn.send(msg);
            }
        }
    });

    return {
        id,
        connections,
        broadcast,
    } as unknown as Party.Room & {
        connections: Map<string, Party.Connection>;
        broadcast: jest.Mock;
    };
}

describe('VenuePresenceRoom (PartyKit Ping/Pong Heartbeat Liveness)', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-11-24T10:00:00.000Z'));
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    test('evicts silent asleep peer after 30s of missed heartbeats and broadcasts peer_left to active peers', () => {
        const room = createMockRoom('venue-pune-fc');
        const server = new VenuePresenceRoom(room);

        const connA = createMockConnection('conn-user-a');
        const connB = createMockConnection('conn-user-b');
        room.connections.set(connA.id, connA);
        room.connections.set(connB.id, connB);

        // User A and User B connect and announce presence
        server.onConnect(connA, {} as Party.ConnectionContext);
        server.onMessage(
            JSON.stringify({
                type: 'join',
                userId: 'user_a',
                displayName: 'Aditya',
                status: 'working',
            }),
            connA
        );

        server.onConnect(connB, {} as Party.ConnectionContext);
        server.onMessage(
            JSON.stringify({
                type: 'join',
                userId: 'user_b',
                displayName: 'Rohan',
                status: 'working',
            }),
            connB
        );

        expect(server.activePeerCount).toBe(2);

        // Advance 10s -> server sends 'ping'; User B replies 'pong', User A's laptop is asleep (no pong)
        jest.advanceTimersByTime(HEARTBEAT_PING_INTERVAL_MS);
        expect(connA.send).toHaveBeenCalledWith(expect.stringContaining('"type":"ping"'));
        expect(connB.send).toHaveBeenCalledWith(expect.stringContaining('"type":"ping"'));

        server.onMessage(JSON.stringify({ type: 'pong' }), connB);

        // Advance to 20s -> User B replies 'pong' again; User A still silent (20s <= 30s threshold)
        jest.advanceTimersByTime(HEARTBEAT_PING_INTERVAL_MS);
        server.onMessage(JSON.stringify({ type: 'pong' }), connB);
        expect(server.activePeerCount).toBe(2);

        // Advance to 30s -> User B replies 'pong'; User A reaches 30s silence
        jest.advanceTimersByTime(HEARTBEAT_PING_INTERVAL_MS);
        server.onMessage(JSON.stringify({ type: 'pong' }), connB);

        // Advance to 40s (> 30s missed heartbeats for User A) -> User A must be evicted and peer_left broadcast
        jest.advanceTimersByTime(HEARTBEAT_PING_INTERVAL_MS);

        expect(server.activePeerCount).toBe(1);
        expect(server.getActivePeers().map((p) => p.userId)).toEqual(['user_b']);
        expect(connA.close).toHaveBeenCalledWith(1001, 'Heartbeat timeout');

        // Verify User B received the `peer_left` diff for User A
        const sentToB = connB.send.mock.calls.map(([raw]) => JSON.parse(String(raw)));
        const peerLeftEvent = sentToB.find(
            (msg) => msg.type === 'peer_left' && msg.peerId === 'conn-user-a'
        );

        expect(peerLeftEvent).toBeDefined();
        expect(peerLeftEvent).toMatchObject({
            type: 'peer_left',
            peerId: 'conn-user-a',
            userId: 'user_a',
            reason: 'heartbeat_timeout',
        });
    });

    test('stops heartbeat interval timer automatically once all peers leave the room', () => {
        const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
        const room = createMockRoom('venue-empty-check');
        const server = new VenuePresenceRoom(room);

        const connA = createMockConnection('conn-solo');
        room.connections.set(connA.id, connA);

        server.onConnect(connA, {} as Party.ConnectionContext);
        expect(server.activePeerCount).toBe(1);

        // Trigger timeout sweep past 30s
        jest.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS + HEARTBEAT_PING_INTERVAL_MS);

        expect(server.activePeerCount).toBe(0);
        expect(clearIntervalSpy).toHaveBeenCalledTimes(1);

        clearIntervalSpy.mockRestore();
    });
});