import WhiteboardRoom from "@/party/whiteboard.room";
import { POST, GET, DELETE } from "@/app/api/whiteboard/route";
import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

jest.mock("@clerk/nextjs/server", () => ({
    auth: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
    prisma: {
        folderMember: {
            findUnique: jest.fn(),
        },
        folder: {
            findUnique: jest.fn(),
        },
    },
}));

describe("Whiteboard Reconnection Sequence & Reconciliation (#5360)", () => {
    let mockRoom: any;
    let server: WhiteboardRoom;
    let mockConnections: any[];

    beforeEach(() => {
        (auth as unknown as jest.Mock).mockResolvedValue({ userId: "mock-test-owner" });
        (prisma.folderMember.findUnique as jest.Mock).mockResolvedValue({
            role: "OWNER",
        });
        (prisma.folder.findUnique as jest.Mock).mockResolvedValue({ ownerId: "mock-test-owner" });

        mockConnections = [];
        mockRoom = {
            id: "test-room-123",
            broadcast: jest.fn((msg: string, without?: string[]) => {
                // deliver to all connections except 'without'
                mockConnections.forEach(c => {
                    if (!without || !without.includes(c.id)) {
                        c._received.push(JSON.parse(msg));
                    }
                });
            }),
        };
        server = new WhiteboardRoom(mockRoom);
    });

    const createMockConn = (id: string) => {
        const conn: any = {
            id,
            _sent: [] as any[],
            _received: [] as any[],
            send: jest.fn((msg: string) => {
                conn._sent.push(JSON.parse(msg));
            }),
        };
        mockConnections.push(conn);
        return conn;
    };

    it("assigns monotonic sequence numbers to operations and broadcasts them in-order", async () => {
        const alice = createMockConn("alice");
        const bob = createMockConn("bob");

        await server.onConnect(alice, {} as any);
        expect(alice._sent[0].type).toBe("INIT_STATE");
        expect(alice._sent[0].sequenceNumber).toBe(0);

        // Alice sends stroke operation 1
        await server.onMessage(JSON.stringify({
            type: "APPLY_OPERATION",
            payload: {
                id: "stroke-1",
                type: "INSERT",
                timestamp: 100,
                nodeId: "alice",
                clientSeq: 1,
            },
        }), alice);

        // Verify Bob received broadcast with sequenceNumber: 1
        expect(bob._received.length).toBe(1);
        expect(bob._received[0].type).toBe("OPERATION_APPLIED");
        expect(bob._received[0].sequenceNumber).toBe(1);
        expect(bob._received[0].payload.id).toBe("stroke-1");

        // Verify Alice received ACK with sequenceNumber: 1
        const ack = alice._sent.find(m => m.type === "OPERATION_ACK");
        expect(ack).toBeDefined();
        expect(ack.sequenceNumber).toBe(1);
        expect(ack.clientSeq).toBe(1);
    });

    it("buffers and reorders out-of-order buffered strokes upon client reconnection", async () => {
        const alice = createMockConn("alice");
        const bob = createMockConn("bob");

        await server.onConnect(alice, {} as any);

        // Alice sends stroke 1 normally
        await server.onMessage(JSON.stringify({
            type: "APPLY_OPERATION",
            payload: { id: "stroke-1", type: "INSERT", timestamp: 100, nodeId: "alice", clientSeq: 1 },
        }), alice);

        // Simulate network reordering: stroke 3 arrives before stroke 2
        await server.onMessage(JSON.stringify({
            type: "APPLY_OPERATION",
            payload: { id: "stroke-3", type: "INSERT", timestamp: 120, nodeId: "alice", clientSeq: 3 },
        }), alice);

        // Bob should not have received stroke 3 yet because stroke 2 is pending
        expect(bob._received.map(m => m.payload.id)).toEqual(["stroke-1"]);

        // Now stroke 2 arrives
        await server.onMessage(JSON.stringify({
            type: "APPLY_OPERATION",
            payload: { id: "stroke-2", type: "INSERT", timestamp: 110, nodeId: "alice", clientSeq: 2 },
        }), alice);

        // Bob should now have received stroke 2 followed by stroke 3 in monotonic sequence order
        const receivedIds = bob._received.map(m => m.payload.id);
        expect(receivedIds).toEqual(["stroke-1", "stroke-2", "stroke-3"]);
        expect(bob._received[1].sequenceNumber).toBe(2);
        expect(bob._received[2].sequenceNumber).toBe(3);
    });

    it("supports replay catch-up via SYNC_REQUEST after brief network disconnection", async () => {
        const alice = createMockConn("alice");
        const bob = createMockConn("bob");

        // Alice performs 3 operations while Bob is disconnected
        for (let i = 1; i <= 3; i++) {
            await server.onMessage(JSON.stringify({
                type: "APPLY_OPERATION",
                payload: { id: `stroke-${i}`, type: "INSERT", timestamp: 100 + i, nodeId: "alice", clientSeq: i },
            }), alice);
        }

        // Bob connects and requests replay from last sequence 1
        await server.onMessage(JSON.stringify({
            type: "SYNC_REQUEST",
            payload: { lastSeq: 1 },
        }), bob);

        // Bob should receive SYNC_REPLAY containing stroke-2 and stroke-3
        const replay = bob._sent.find(m => m.type === "SYNC_REPLAY");
        expect(replay).toBeDefined();
        expect(replay.payload.fromSeq).toBe(2);
        expect(replay.payload.toSeq).toBe(3);
        expect(replay.payload.operations.map((o: any) => o.id)).toEqual(["stroke-2", "stroke-3"]);
    });

    it("processes client batch reconnection (BATCH_OPERATIONS) monotonically", async () => {
        const alice = createMockConn("alice");
        const bob = createMockConn("bob");

        // Alice reconnects with buffered strokes 1 and 2 in a batch
        await server.onMessage(JSON.stringify({
            type: "BATCH_OPERATIONS",
            payload: {
                operations: [
                    { id: "stroke-b", type: "INSERT", timestamp: 200, nodeId: "alice", clientSeq: 2 },
                    { id: "stroke-a", type: "INSERT", timestamp: 100, nodeId: "alice", clientSeq: 1 },
                ],
            },
        }), alice);

        // Should ACK batch and broadcast applied operations in chronological/sequence order
        expect(alice._sent[0].type).toBe("BATCH_ACK");
        expect(alice._sent[0].appliedCount).toBe(2);

        expect(bob._received[0].type).toBe("BATCH_OPERATIONS_APPLIED");
        expect(bob._received[0].payload.operations.map((o: any) => o.id)).toEqual(["stroke-a", "stroke-b"]);
    });

    describe("Whiteboard API Route (/api/whiteboard)", () => {
        it("saves and retrieves whiteboard state with monotonic sequence numbering", async () => {
            const saveReq = new NextRequest("http://localhost/api/whiteboard", {
                method: "POST",
                body: JSON.stringify({
                    roomId: "room-abc",
                    state: { elements: {}, vectorClock: { nodeA: 1 } },
                    sequenceNumber: 5,
                }),
            });

            const saveRes = await POST(saveReq);
            const saveData = await saveRes.json();

            expect(saveRes.status).toBe(200);
            expect(saveData.success).toBe(true);
            expect(saveData.sequenceNumber).toBe(5);

            // Fetch state
            const getReq = new NextRequest("http://localhost/api/whiteboard?roomId=room-abc", {
                method: "GET",
            });
            const getRes = await GET(getReq);
            const getData = await getRes.json();

            expect(getRes.status).toBe(200);
            expect(getData.sequenceNumber).toBe(5);
            expect(getData.state.vectorClock).toEqual({ nodeA: 1 });
        });

        it("rejects stale sequence updates with conflict status 409", async () => {
            // First save at sequence 10
            await POST(new NextRequest("http://localhost/api/whiteboard", {
                method: "POST",
                body: JSON.stringify({
                    roomId: "room-seq-test",
                    state: { elements: {}, vectorClock: {} },
                    sequenceNumber: 10,
                }),
            }));

            // Stale update at sequence 8
            const staleRes = await POST(new NextRequest("http://localhost/api/whiteboard", {
                method: "POST",
                body: JSON.stringify({
                    roomId: "room-seq-test",
                    state: { elements: {}, vectorClock: {} },
                    sequenceNumber: 8,
                }),
            }));

            expect(staleRes.status).toBe(409);
            const staleData = await staleRes.json();
            expect(staleData.error).toBe("Stale sequence update");
            expect(staleData.currentSequence).toBe(10);
        });
    });
});
