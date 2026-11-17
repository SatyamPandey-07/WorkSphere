import * as Y from "yjs";
import { CrdtDeltaSyncSession } from "@/lib/crdt/canvasProvider";
import {
  CRDT_FRAME_HEADER_SIZE,
  CRDT_FRAME_MAGIC,
  CRDT_MAX_CHUNK_PAYLOAD_SIZE,
  CRDT_MAX_SCTP_MESSAGE_SIZE,
  CrdtFrameMessageType,
  CrdtFrameReassembler,
  decodeCrdtFrame,
  encodeCrdtFrames,
} from "@/lib/crdt/dataChannelFraming";
import { attachCrdtDeltaSyncChannel } from "@/lib/realtime/webrtc/meshConnection";

describe("CRDT Delta-State Vector Sync & 64 KiB Binary MTU Framing", () => {
  it("reduces initial synchronization payload by >80% when joining an existing whiteboard room", () => {
    // Seed Peer B with an established whiteboard containing 250 existing strokes
    const docB = new Y.Doc();
    const strokesB = docB.getArray<Record<string, unknown>>("strokes");
    docB.transact(() => {
      for (let i = 0; i < 250; i++) {
        strokesB.push([
          {
            id: `stroke-${i}`,
            color: "#10b981",
            points: Array.from({ length: 16 }, (_, p) => [i + p, p * 2]),
          },
        ]);
      }
    });

    // Peer A already synced up to stroke 244, then went offline briefly while Peer B added 5 strokes
    const docA = new Y.Doc();
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));

    docB.transact(() => {
      for (let i = 250; i < 255; i++) {
        strokesB.push([
          {
            id: `stroke-${i}`,
            color: "#3b82f6",
            points: [
              [i, 10],
              [i + 5, 20],
            ],
          },
        ]);
      }
    });

    const wireAtoB: Uint8Array[] = [];
    const wireBtoA: Uint8Array[] = [];

    const sessionA = new CrdtDeltaSyncSession({
      doc: docA,
      peerId: "peer-A",
      sendFrame: (f) => wireAtoB.push(f),
    });

    const sessionB = new CrdtDeltaSyncSession({
      doc: docB,
      peerId: "peer-B",
      sendFrame: (f) => wireBtoA.push(f),
    });

    // Step 1: Peer A sends compact state vector to Peer B
    const svA = sessionA.initiateStateVectorHandshake();
    expect(wireAtoB.length).toBe(1);
    for (const frame of wireAtoB) {
      sessionB.receiveFrame(frame);
    }

    // Step 2: Peer B transmits only the missing delta diff back to Peer A
    expect(wireBtoA.length).toBeGreaterThanOrEqual(1);
    for (const frame of wireBtoA) {
      sessionA.receiveFrame(frame);
    }

    // Assert exact document convergence
    expect(docA.getArray("strokes").length).toBe(255);
    expect(docA.getArray("strokes").toJSON()).toEqual(
      docB.getArray("strokes").toJSON(),
    );

    // Assert >80% bandwidth reduction compared to full Yjs document state
    const fullStateSize = Y.encodeStateAsUpdate(docB).byteLength;
    const totalHandshakeBytes =
      svA.byteLength + sessionB.metrics.deltaBytesSent;
    const savingsRatio = 1 - totalHandshakeBytes / fullStateSize;

    expect(savingsRatio).toBeGreaterThan(0.8);
  });

  it("fragments delta updates exceeding 64 KiB into 16-byte-header MTU frames and reassembles cleanly", () => {
    // Create a large 180 KiB payload (> 2 x 65,520 bytes -> 3 chunks)
    const largePayload = new Uint8Array(180 * 1024);
    for (let i = 0; i < largePayload.length; i++) {
      largePayload[i] = (i * 31) & 0xff;
    }

    const frames = encodeCrdtFrames(largePayload, {
      messageId: 42,
      messageType: CrdtFrameMessageType.DELTA_UPDATE,
    });

    expect(frames.length).toBe(
      Math.ceil(largePayload.byteLength / CRDT_MAX_CHUNK_PAYLOAD_SIZE),
    );
    expect(frames.length).toBe(3);

    for (let idx = 0; idx < frames.length; idx++) {
      const frame = frames[idx];
      expect(frame.byteLength).toBeLessThanOrEqual(CRDT_MAX_SCTP_MESSAGE_SIZE);

      const header = decodeCrdtFrame(frame);
      expect(header.magic).toBe(CRDT_FRAME_MAGIC);
      expect(header.messageId).toBe(42);
      expect(header.chunkIndex).toBe(idx);
      expect(header.totalChunks).toBe(3);
      expect(header.payloadLength).toBe(
        frame.byteLength - CRDT_FRAME_HEADER_SIZE,
      );
    }

    const reassembler = new CrdtFrameReassembler();
    expect(reassembler.pushFrame(frames[0])).toBeNull();
    expect(reassembler.pushFrame(frames[1])).toBeNull();
    const completed = reassembler.pushFrame(frames[2]);

    expect(completed).not.toBeNull();
    expect(completed!.messageId).toBe(42);
    expect(completed!.messageType).toBe(CrdtFrameMessageType.DELTA_UPDATE);
    expect(completed!.payload).toEqual(largePayload);
  });

  it("handles concurrent reciprocal diff exchanges idempotently without duplicate application", () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    docA.getMap("shapes").set("rect-a", { x: 10, y: 20 });
    docB.getMap("shapes").set("rect-b", { x: 50, y: 80 });

    const queueAtoB: Uint8Array[] = [];
    const queueBtoA: Uint8Array[] = [];

    const sessionA = new CrdtDeltaSyncSession({
      doc: docA,
      peerId: "peer-A",
      sendFrame: (f) => queueAtoB.push(f),
    });
    const sessionB = new CrdtDeltaSyncSession({
      doc: docB,
      peerId: "peer-B",
      sendFrame: (f) => queueBtoA.push(f),
    });

    // Both peers initiate handshake concurrently before receiving the other's message
    sessionA.initiateStateVectorHandshake();
    sessionB.initiateStateVectorHandshake();

    const svFramesFromA = queueAtoB.splice(0);
    const svFramesFromB = queueBtoA.splice(0);

    for (const f of svFramesFromA) sessionB.receiveFrame(f);
    for (const f of svFramesFromB) sessionA.receiveFrame(f);

    const deltaFramesFromB = queueBtoA.splice(0);
    const deltaFramesFromA = queueAtoB.splice(0);

    // Apply reciprocal deltas
    for (const f of deltaFramesFromB) sessionA.receiveFrame(f);
    for (const f of deltaFramesFromA) sessionB.receiveFrame(f);

    // Replay the exact same delta frames again (simulating concurrent duplicate delivery)
    for (const f of deltaFramesFromB) {
      const res = sessionA.receiveFrame(f);
      expect(res.completed).toBe(false); // Dropped as duplicate messageId at reassembler
    }

    // Also test direct duplicate delta byte ingestion at CRDT layer
    const rawDelta = Y.encodeStateAsUpdate(docB);
    expect(sessionA.applyDeltaIdempotently(rawDelta)).toBe(false);
    expect(sessionA.metrics.duplicateUpdatesIgnored).toBeGreaterThanOrEqual(1);

    // Both docs converge identically with both concurrent shapes preserved
    expect(docA.getMap("shapes").toJSON()).toEqual({
      "rect-a": { x: 10, y: 20 },
      "rect-b": { x: 50, y: 80 },
    });
    expect(docB.getMap("shapes").toJSON()).toEqual(
      docA.getMap("shapes").toJSON(),
    );
  });

  it("synchronizes two RTCDataChannel endpoints end-to-end with chunked large updates", () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    // Populate Peer A with a large 140 KiB drawing payload so MTU chunking triggers over DataChannel
    docA.getMap("board").set("blob", "X".repeat(140 * 1024));

    const listenersA = new Map<string, Set<(ev: unknown) => void>>();
    const listenersB = new Map<string, Set<(ev: unknown) => void>>();

    const emit = (
      map: Map<string, Set<(ev: unknown) => void>>,
      type: string,
      ev: unknown,
    ) => {
      map.get(type)?.forEach((fn) => fn(ev));
    };

    const channelA = {
      readyState: "open",
      binaryType: "arraybuffer",
      send: jest.fn((data: ArrayBuffer) => {
        expect(data.byteLength).toBeLessThanOrEqual(CRDT_MAX_SCTP_MESSAGE_SIZE);
        emit(listenersB, "message", { data });
      }),
      addEventListener: (type: string, fn: (ev: unknown) => void) => {
        if (!listenersA.has(type)) listenersA.set(type, new Set());
        listenersA.get(type)!.add(fn);
      },
      removeEventListener: (type: string, fn: (ev: unknown) => void) => {
        listenersA.get(type)?.delete(fn);
      },
    } as unknown as RTCDataChannel;

    const channelB = {
      readyState: "open",
      binaryType: "arraybuffer",
      send: jest.fn((data: ArrayBuffer) => {
        expect(data.byteLength).toBeLessThanOrEqual(CRDT_MAX_SCTP_MESSAGE_SIZE);
        emit(listenersA, "message", { data });
      }),
      addEventListener: (type: string, fn: (ev: unknown) => void) => {
        if (!listenersB.has(type)) listenersB.set(type, new Set());
        listenersB.get(type)!.add(fn);
      },
      removeEventListener: (type: string, fn: (ev: unknown) => void) => {
        listenersB.get(type)?.delete(fn);
      },
    } as unknown as RTCDataChannel;

    const bindingA = attachCrdtDeltaSyncChannel(channelA, docA, "peer-A");
    const bindingB = attachCrdtDeltaSyncChannel(channelB, docB, "peer-B");

    // Verify large 140 KiB delta was fragmented into >= 3 chunks and converged on Peer B
    expect(
      (channelA.send as jest.Mock).mock.calls.length,
    ).toBeGreaterThanOrEqual(3);
    expect(docB.getMap("board").get("blob")).toBe(
      docA.getMap("board").get("blob"),
    );

    bindingA.detach();
    bindingB.detach();
  });
});
