import LocalMeshRoom, {
    HybridLogicalClock,
    compareHLC,
    isVectorClockDominantOrConcurrent,
    HLCTimestamp,
} from '@/party/localMesh.room';

describe('LocalMeshRoom CRDT HLC Clock Drift Reconciliation (#5744)', () => {
    describe('HybridLogicalClock implementation', () => {
        it('advances logical counter when physical clock is stagnant or backwards', () => {
            const hlc = new HybridLogicalClock('node-a');
            const t1 = hlc.now(1000);
            expect(t1.logicalTime).toBe(1000);
            expect(t1.counter).toBe(0);
            expect(t1.nodeId).toBe('node-a');

            // Stagnant physical clock
            const t2 = hlc.now(1000);
            expect(t2.logicalTime).toBe(1000);
            expect(t2.counter).toBe(1);

            // Backward physical clock (e.g. NTP clock adjustment backwards)
            const t3 = hlc.now(950);
            expect(t3.logicalTime).toBe(1000);
            expect(t3.counter).toBe(2);

            // Physical clock catches up
            const t4 = hlc.now(1200);
            expect(t4.logicalTime).toBe(1200);
            expect(t4.counter).toBe(0);
        });

        it('reconciles with remote messages advancing past maximum received timestamp', () => {
            const localHlc = new HybridLogicalClock('local-node');
            localHlc.now(1000);

            const remoteTimestamp: HLCTimestamp = {
                logicalTime: 2000,
                counter: 5,
                nodeId: 'remote-node',
            };

            const updated = localHlc.update(remoteTimestamp, 1500);
            expect(updated.logicalTime).toBe(2000);
            expect(updated.counter).toBe(6);
        });

        it('compareHLC orders timestamps deterministically with node ID tie breaker', () => {
            const a: HLCTimestamp = { logicalTime: 1000, counter: 1, nodeId: 'node-a' };
            const b: HLCTimestamp = { logicalTime: 1000, counter: 2, nodeId: 'node-a' };
            const c: HLCTimestamp = { logicalTime: 1000, counter: 1, nodeId: 'node-b' };
            const d: HLCTimestamp = { logicalTime: 2000, counter: 0, nodeId: 'node-a' };

            expect(compareHLC(a, b)).toBeLessThan(0);
            expect(compareHLC(b, a)).toBeGreaterThan(0);
            expect(compareHLC(a, c)).toBeLessThan(0); // node-a < node-b
            expect(compareHLC(a, d)).toBeLessThan(0);
        });
    });

    describe('Vector Clock Dominance', () => {
        it('detects causal dominance between vector clocks', () => {
            const v1 = { a: 1, b: 2 };
            const v2 = { a: 2, b: 3 };
            const vConcurrent = { a: 3, b: 1 };

            expect(isVectorClockDominantOrConcurrent(v2, v1)).toBe(true);
            expect(isVectorClockDominantOrConcurrent(v1, v2)).toBe(false);
            expect(isVectorClockDominantOrConcurrent(vConcurrent, v2)).toBe(true); // concurrent
        });
    });

    describe('LocalMeshRoom Partitioned Branches Reconciliation', () => {
        let mockRoom: any;
        let room: LocalMeshRoom;
        let mockConnections: Map<string, any>;

        beforeEach(() => {
            mockConnections = new Map();
            mockRoom = {
                id: 'mesh-room-partition-test',
                getConnection: (id: string) => mockConnections.get(id),
                getConnections: () => Array.from(mockConnections.values()),
                broadcast: jest.fn((msg: string, without?: string[]) => {
                    for (const [id, conn] of mockConnections.entries()) {
                        if (!without || !without.includes(id)) {
                            conn._received.push(JSON.parse(msg));
                        }
                    }
                }),
            };
            room = new LocalMeshRoom(mockRoom);
        });

        const createMockPeer = (id: string) => {
            const peer = {
                id,
                _sent: [] as any[],
                _received: [] as any[],
                send: jest.fn((msg: string) => {
                    peer._sent.push(JSON.parse(msg));
                }),
            };
            mockConnections.set(id, peer);
            return peer;
        };

        it('reconciles two partitioned branches with clock skews without wall-clock skew bias', async () => {
            const peerA = createMockPeer('cluster-a-peer'); // Cluster A has a lagging wall-clock
            const peerB = createMockPeer('cluster-b-peer'); // Cluster B has a fast/advanced wall-clock

            await room.onConnect(peerA, {} as any);
            await room.onConnect(peerB, {} as any);

            // Simulation:
            // Partition occurs.
            // In Partition A (wall clock lagging: 10:00:00 = 1000000ms), user edits note key "venue_wifi_notes" to "WiFi 5GHz Fast".
            // Partition A operates with HLC tracking:
            const hlcA = new HybridLogicalClock('cluster-a-peer');
            const hlcA_t1 = hlcA.now(1000000);

            // In Partition B (wall clock has +5 hours skew: 15:00:00 = 18000000ms due to miscalibrated device clock),
            // user concurrently edits "venue_wifi_notes" to "WiFi Down".
            // But Cluster A then performs a subsequent causal edit "WiFi 5GHz Verified & Tested" with higher logical sequence!
            const hlcB = new HybridLogicalClock('cluster-b-peer');
            const hlcB_t1 = hlcB.now(18000000); // Erroneous high wall-clock

            // Cluster B connects and applies its update first
            await room.onMessage(JSON.stringify({
                type: 'SYNC_UPDATE',
                key: 'venue_wifi_notes',
                update: 'WiFi Down',
                senderId: 'cluster-b-peer',
                hlc: hlcB_t1,
                timestamp: 18000000,
            }), peerB);

            expect(room.getLwwDocumentState().get('venue_wifi_notes')?.value).toBe('WiFi Down');

            // Now Cluster A reconciles. The user made an edit after learning of B's state or advancing their HLC past B:
            const hlcA_t2 = hlcA.update(hlcB_t1, 1000100); // advances past B's high clock
            const hlcA_final = hlcA.now(1000200);

            await room.onMessage(JSON.stringify({
                type: 'SYNC_UPDATE',
                key: 'venue_wifi_notes',
                update: 'WiFi 5GHz Verified & Tested',
                senderId: 'cluster-a-peer',
                hlc: hlcA_final,
                timestamp: 1000200, // Even though wall-clock is 1000200 vs B's 18000000, HLC logicalTime/counter correctly supersedes B
            }), peerA);

            // Verification: HLC correctly preserves Cluster A's causal edit rather than discarding it due to B's wall clock drift!
            const finalState = room.getLwwDocumentState().get('venue_wifi_notes');
            expect(finalState?.value).toBe('WiFi 5GHz Verified & Tested');
        });

        it('discards stale updates from skewed nodes that try to overwrite newer HLC state', async () => {
            const peerA = createMockPeer('peer-a');
            const peerB = createMockPeer('peer-b');

            await room.onConnect(peerA, {} as any);
            await room.onConnect(peerB, {} as any);

            const hlcA = new HybridLogicalClock('peer-a');
            const tA = hlcA.now(5000);

            // Peer A sets key
            await room.onMessage(JSON.stringify({
                type: 'SYNC_UPDATE',
                key: 'desk_reservation',
                update: 'Desk 4 Reserved by Peer A',
                senderId: 'peer-a',
                hlc: tA,
            }), peerA);

            // Peer B with lagging clock tries to send an older update with lower logical time
            const olderHlcB: HLCTimestamp = {
                logicalTime: 4000,
                counter: 0,
                nodeId: 'peer-b',
            };

            await room.onMessage(JSON.stringify({
                type: 'SYNC_UPDATE',
                key: 'desk_reservation',
                update: 'Desk 4 Reserved by Peer B (Stale)',
                senderId: 'peer-b',
                hlc: olderHlcB,
            }), peerB);

            // State should remain Peer A's newer edit
            expect(room.getLwwDocumentState().get('desk_reservation')?.value).toBe('Desk 4 Reserved by Peer A');
        });

        it('handles SYNC_REQUEST with sinceHlc filter correctly', async () => {
            const peer = createMockPeer('peer-sync');
            await room.onConnect(peer, {} as any);

            const hlc = new HybridLogicalClock('server-root');
            const t1 = hlc.now(1000);
            const t2 = hlc.now(2000);

            await room.onMessage(JSON.stringify({
                type: 'SYNC_UPDATE',
                update: 'Update 1',
                senderId: 'peer-sync',
                hlc: t1,
            }), peer);

            await room.onMessage(JSON.stringify({
                type: 'SYNC_UPDATE',
                update: 'Update 2',
                senderId: 'peer-sync',
                hlc: t2,
            }), peer);

            peer._sent = []; // clear initial messages

            // Request updates newer than t1
            await room.onMessage(JSON.stringify({
                type: 'SYNC_REQUEST',
                senderId: 'peer-sync',
                sinceHlc: t1,
            }), peer);

            expect(peer._sent.length).toBe(1);
            expect(peer._sent[0].type).toBe('SYNC_RESPONSE');
            expect(peer._sent[0].updates.length).toBe(1);
            expect(peer._sent[0].updates[0].update).toBe('Update 2');
        });
    });
});
