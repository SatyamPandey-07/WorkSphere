import WhiteboardRoom from "@/party/whiteboard.room";
import { POST, GET, DELETE } from "@/app/api/whiteboard/route";
import { NextRequest } from "next/server";

describe("Whiteboard Reconnection Sequence & Reconciliation (#5360)", () => {
    let mockRoom: any;
    let server: WhiteboardRoom;
    let mockConnections: any[];

    beforeEach(() => {
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
                type: "DRAW_STROKE",
                nodeId: "alice",
                timestamp: 1000,
                vectorClock: { alice: 1 },
                payload: { points: [0, 0, 10, 10] },
                clientSeq: 1,
            },
        }), alice);

        // Alice receives ACK with sequenceNumber=1
        expect(alice._sent[1].type).toBe("OPERATION_ACK");
        expect(alice._sent[1].sequenceNumber).toBe(1);

        // Bob receives OPERATION_APPLIED with sequenceNumber=1
        expect(bob._received[0].type).toBe("OPERATION_APPLIED");
        expect(bob._received[0].sequenceNumber).toBe(1);
        expect(bob._received[0].payload.id).toBe("stroke-1");

        // Alice sends stroke operation 2
        await server.onMessage(JSON.stringify({
            type: "APPLY_OPERATION",
            payload: {
                id: "stroke-2",
                type: "DRAW_STROKE",
                nodeId: "alice",
                timestamp: 1050,
                vectorClock: { alice: 2 },
                payload: { points: [10, 10, 20, 20] },
                clientSeq: 2,
            },
        }), alice);

        expect(alice._sent[2].sequenceNumber).toBe(2);
        expect(bob._received[1].sequenceNumber).toBe(2);
    });

    it("grants an ephemeral note lease and rejects other users' updates until release", async () => {
        const alice = createMockConn("alice");
        const bob = createMockConn("bob");

        await server.onMessage(JSON.stringify({
            type: "HOLD_NOTE",
            payload: { noteId: "note-1", userId: "alice-user", requestId: "hold-1" },
        }), alice);

        expect(alice._sent[0]).toMatchObject({
            type: "NOTE_LOCK_GRANTED",
            payload: { noteId: "note-1", requestId: "hold-1" },
        });
        expect(bob._received[0]).toMatchObject({
            type: "NOTE_LOCK_STATE",
            payload: { noteId: "note-1", ownerUserId: "alice-user" },
        });

        await server.onMessage(JSON.stringify({
            type: "HOLD_NOTE",
            payload: { noteId: "note-1", userId: "bob-user", requestId: "hold-2" },
        }), bob);
        expect(bob._sent[0]).toMatchObject({
            type: "NOTE_LOCK_DENIED",
            payload: { noteId: "note-1", requestId: "hold-2" },
        });

        await server.onMessage(JSON.stringify({
            type: "APPLY_OPERATION",
            payload: {
                id: "note-1",
                type: "ADD_TEXT",
                nodeId: "bob-user",
                timestamp: 1000,
                vectorClock: { "bob-user": 1 },
                payload: { points: [20, 30, 240, 160] },
            },
        }), bob);
        expect(bob._sent.some((message: any) => message.type === "OPERATION_REJECTED")).toBe(true);
        expect(alice._received.some((message: any) => message.type === "OPERATION_APPLIED")).toBe(false);

        await server.onMessage(JSON.stringify({
            type: "RELEASE_NOTE",
            payload: { noteId: "note-1" },
        }), alice);
        expect(bob._received.some(
            (message: any) =>
                message.type === "NOTE_LOCK_STATE" &&
                message.payload.noteId === "note-1" &&
                message.payload.ownerUserId === null,
        )).toBe(true);

        await server.onMessage(JSON.stringify({
            type: "APPLY_OPERATION",
            payload: {
                id: "note-1",
                type: "ADD_TEXT",
                nodeId: "bob-user",
                timestamp: 1001,
                vectorClock: { "bob-user": 1 },
                payload: { points: [30, 40, 250, 170] },
            },
        }), bob);
        expect(bob._sent.some((message: any) => message.type === "OPERATION_ACK")).toBe(true);
    });

    it("expires note leases automatically", async () => {
        jest.useFakeTimers();
        try {
            const alice = createMockConn("alice");
            const bob = createMockConn("bob");
            await server.onMessage(JSON.stringify({
                type: "HOLD_NOTE",
                payload: { noteId: "note-expiring", userId: "alice-user" },
            }), alice);

            jest.advanceTimersByTime(5000);
            await server.onMessage(JSON.stringify({
                type: "HOLD_NOTE",
                payload: { noteId: "note-expiring", userId: "bob-user", requestId: "after-expiry" },
            }), bob);

            expect(bob._sent.some((message: any) => message.type === "NOTE_LOCK_GRANTED")).toBe(true);
        } finally {
            jest.useRealTimers();
        }
    });

    it("reconciles out-of-order buffered strokes upon client reconnection", async () => {
        const alice = createMockConn("alice");
        const bob = createMockConn("bob");

        // Alice sends stroke 1
        await server.onMessage(JSON.stringify({
            type: "APPLY_OPERATION",
            payload: {
                id: "stroke-1",
                type: "DRAW_STROKE",
                nodeId: "alice",
                timestamp: 1000,
                vectorClock: { alice: 1 },
                payload: { points: [0, 0] },
                clientSeq: 1,
            },
        }), alice);

        // Alice temporarily disconnects, buffers stroke 2 and stroke 3, but stroke 3 arrives before stroke 2
        await server.onMessage(JSON.stringify({
            type: "APPLY_OPERATION",
            payload: {
                id: "stroke-3",
                type: "DRAW_STROKE",
                nodeId: "alice",
                timestamp: 1020,
                vectorClock: { alice: 3 },
                payload: { points: [20, 20] },
                clientSeq: 3, // Gap! Expected was 2
            },
        }), alice);

        // Bob should NOT receive stroke 3 yet because stroke 2 is missing
        expect(bob._received).toHaveLength(1);
        expect(bob._received[0].payload.id).toBe("stroke-1");

        // Now stroke 2 arrives
        await server.onMessage(JSON.stringify({
            type: "APPLY_OPERATION",
            payload: {
                id: "stroke-2",
                type: "DRAW_STROKE",
                nodeId: "alice",
                timestamp: 1010,
                vectorClock: { alice: 2 },
                payload: { points: [10, 10] },
                clientSeq: 2,
            },
        }), alice);

        // Both stroke 2 and stroke 3 are applied and broadcasted in strict sequence order (2 then 3)
        expect(bob._received).toHaveLength(3);
        expect(bob._received[1].payload.id).toBe("stroke-2");
        expect(bob._received[1].sequenceNumber).toBe(2);
        expect(bob._received[2].payload.id).toBe("stroke-3");
        expect(bob._received[2].sequenceNumber).toBe(3);
    });

    it("replays missed operations in strict order when client sends SYNC_REQUEST with lastSeq", async () => {
        const alice = createMockConn("alice");
        const bob = createMockConn("bob");

        // Server processes operations 1, 2, 3
        for (let i = 1; i <= 3; i++) {
            await server.onMessage(JSON.stringify({
                type: "APPLY_OPERATION",
                payload: {
                    id: `stroke-${i}`,
                    type: "DRAW_STROKE",
                    nodeId: "alice",
                    timestamp: 1000 + i,
                    vectorClock: { alice: i },
                    payload: { points: [i, i] },
                    clientSeq: i,
                },
            }), alice);
        }

        // Bob reconnected after being disconnected since sequence 1
        await server.onMessage(JSON.stringify({
            type: "SYNC_REQUEST",
            payload: {
                lastSeq: 1,
            },
        }), bob);

        expect(bob._sent).toHaveLength(1);
        const replayMsg = bob._sent[0];
        expect(replayMsg.type).toBe("SYNC_REPLAY");
        expect(replayMsg.payload.fromSeq).toBe(2);
        expect(replayMsg.payload.toSeq).toBe(3);
        expect(replayMsg.payload.operations.map((o: any) => o.id)).toEqual(["stroke-2", "stroke-3"]);
    });

    it("applies batched strokes in monotonic order upon reconnect", async () => {
        const alice = createMockConn("alice");
        const bob = createMockConn("bob");

        const batchedOps = [
            {
                id: "stroke-b",
                type: "DRAW_STROKE",
                nodeId: "alice",
                timestamp: 2000,
                vectorClock: { alice: 2 },
                payload: { points: [20, 20] },
                clientSeq: 2,
            },
            {
                id: "stroke-a",
                type: "DRAW_STROKE",
                nodeId: "alice",
                timestamp: 1000,
                vectorClock: { alice: 1 },
                payload: { points: [10, 10] },
                clientSeq: 1,
            },
        ];

        await server.onMessage(JSON.stringify({
            type: "APPLY_BATCH",
            payload: { operations: batchedOps },
        }), alice);

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
