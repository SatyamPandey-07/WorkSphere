import * as Y from "yjs";
import {
  MIN_COMPRESSIBLE_BYTES,
  WIRE_MAGIC_V2,
  WireCodec,
  compressYjsUpdateAsync,
  decompressYjsUpdateAsync,
  encodeYjsWirePayload,
  decodeYjsWirePayload,
  getCompressionRatio,
} from "@/lib/crdt/yjsCompression";
import {
  CrdtDeltaSyncSession,
  OfflineCanvasProvider,
} from "@/lib/crdt/canvasProvider";

function buildDrawingVectorUpdate(strokeCount: number): Uint8Array {
  const doc = new Y.Doc();
  const strokes = doc.getArray<Y.Map<unknown>>("strokes");

  doc.transact(() => {
    for (let i = 0; i < strokeCount; i++) {
      const stroke = new Y.Map<unknown>();
      stroke.set("id", `stroke-session-${i}`);
      stroke.set("type", "pen");
      stroke.set("color", i % 2 === 0 ? "#2563eb" : "#10b981");
      stroke.set("strokeWidth", 3);
      // Repetitive normalized coordinates representative of vector stroke polylines
      const points = Array.from({ length: 48 }, (_, idx) =>
        Number(((i * 12 + idx * 1.5) % 1024).toFixed(2)),
      );
      stroke.set("points", points);
      strokes.push([stroke]);
    }
  });

  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}

describe("CRDT state-vector delta compression (#9440)", () => {
  it("bypasses stream compression for payloads <= 512 bytes", async () => {
    const smallPayload = new Uint8Array(MIN_COMPRESSIBLE_BYTES);
    for (let i = 0; i < smallPayload.length; i++) {
      smallPayload[i] = i & 0xff;
    }

    const compressed = await compressYjsUpdateAsync(smallPayload);
    expect(compressed).toEqual(smallPayload);

    const roundtrip = await decompressYjsUpdateAsync(compressed);
    expect(roundtrip).toEqual(smallPayload);
  });

  it("achieves 40-70%+ payload size reduction on typical drawing vector updates with lossless roundtrip", async () => {
    const rawUpdate = buildDrawingVectorUpdate(60);
    expect(rawUpdate.byteLength).toBeGreaterThan(MIN_COMPRESSIBLE_BYTES);

    const compressed = await compressYjsUpdateAsync(rawUpdate);
    const reductionPct = getCompressionRatio(
      rawUpdate.byteLength,
      compressed.byteLength,
    );

    expect(compressed.byteLength).toBeLessThan(rawUpdate.byteLength);
    expect(reductionPct).toBeGreaterThanOrEqual(40);

    const decompressed = await decompressYjsUpdateAsync(compressed);
    expect(decompressed).toEqual(rawUpdate);

    // Verify Yjs document reconstructs cleanly
    const targetDoc = new Y.Doc();
    Y.applyUpdate(targetDoc, decompressed);
    expect(targetDoc.getArray("strokes").length).toBe(60);
    targetDoc.destroy();
  });

  it("falls back gracefully when CompressionStream / DecompressionStream are unsupported", async () => {
    const origCompressionStream = (globalThis as Record<string, unknown>)
      .CompressionStream;
    const origDecompressionStream = (globalThis as Record<string, unknown>)
      .DecompressionStream;

    try {
      delete (globalThis as Record<string, unknown>).CompressionStream;
      delete (globalThis as Record<string, unknown>).DecompressionStream;

      const rawUpdate = buildDrawingVectorUpdate(30);
      expect(rawUpdate.byteLength).toBeGreaterThan(MIN_COMPRESSIBLE_BYTES);

      const compressed = await compressYjsUpdateAsync(rawUpdate);
      expect(compressed.byteLength).toBeLessThan(rawUpdate.byteLength);
      // Should use v2 frame with LZ77 fallback codec when native streams are absent
      expect(compressed.subarray(0, WIRE_MAGIC_V2.length)).toEqual(
        WIRE_MAGIC_V2,
      );
      expect(compressed[WIRE_MAGIC_V2.length]).toBe(WireCodec.LZ77);

      const restored = await decompressYjsUpdateAsync(compressed);
      expect(restored).toEqual(rawUpdate);

      // Also verify encodeYjsWirePayload / decodeYjsWirePayload fallback
      const wireEncoded = await encodeYjsWirePayload(rawUpdate);
      const wireDecoded = await decodeYjsWirePayload(wireEncoded);
      expect(wireDecoded).toEqual(rawUpdate);
    } finally {
      if (origCompressionStream !== undefined) {
        (globalThis as Record<string, unknown>).CompressionStream =
          origCompressionStream;
      }
      if (origDecompressionStream !== undefined) {
        (globalThis as Record<string, unknown>).DecompressionStream =
          origDecompressionStream;
      }
    }
  });

  it("integrates compressed state-vector delta sync in CrdtDeltaSyncSession and OfflineCanvasProvider", async () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    // Populate large drawing session on Peer A
    const strokesA = docA.getArray<Y.Map<unknown>>("strokes");
    docA.transact(() => {
      for (let i = 0; i < 40; i++) {
        const m = new Y.Map<unknown>();
        m.set("id", `s-${i}`);
        m.set("points", [10, 20, 30, 40, 50, 60, 70, 80]);
        strokesA.push([m]);
      }
    });

    const wireFrames: Uint8Array[] = [];
    const sessionA = new CrdtDeltaSyncSession({
      doc: docA,
      peerId: "peer-a",
      sendFrame: (frame) => wireFrames.push(frame),
    });
    const sessionB = new CrdtDeltaSyncSession({
      doc: docB,
      peerId: "peer-b",
      sendFrame: (frame) => wireFrames.push(frame),
    });

    // Peer B initiates state vector handshake -> Peer A responds with compressed delta
    sessionB.initiateStateVectorHandshake();
    expect(wireFrames).toHaveLength(1);
    await sessionA.receiveFrame(wireFrames.shift()!);

    expect(wireFrames).toHaveLength(1);
    const deltaFrame = wireFrames.shift()!;
    const rawStateSize = Y.encodeStateAsUpdate(docA).byteLength;
    expect(deltaFrame.byteLength).toBeLessThan(rawStateSize);

    await sessionB.receiveFrame(deltaFrame);
    expect(docB.getArray("strokes").length).toBe(40);

    // Verify OfflineCanvasProvider compresses flushed journal updates
    const origGlobalIdb = (globalThis as Record<string, unknown>).indexedDB;
    const origWindowIdb =
      typeof window !== "undefined"
        ? (window as unknown as Record<string, unknown>).indexedDB
        : undefined;

    Object.defineProperty(globalThis, "indexedDB", {
      value: undefined,
      configurable: true,
    });
    if (typeof window !== "undefined") {
      Object.defineProperty(window, "indexedDB", {
        value: undefined,
        configurable: true,
      });
    }

    try {
      const sentBuffers: Uint8Array[] = [];
      const provider = new OfflineCanvasProvider({
        roomId: "room-compress-test",
        doc: docA,
      });
      provider.setOnlineStatus(false);
      await provider.journal.appendUpdate(Y.encodeStateAsUpdate(docA));

      const replayResult = await provider.attachSocketAndReplay({
        readyState: 1,
        send: (data) => {
          if (data instanceof Uint8Array) sentBuffers.push(data);
        },
      });
      expect(replayResult.sentFrames).toBeGreaterThanOrEqual(1);
      expect(sentBuffers[0].byteLength).toBeLessThan(
        replayResult.mergedByteLength + 16,
      );

      provider.destroy();
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        value: origGlobalIdb,
        configurable: true,
      });
      if (typeof window !== "undefined") {
        Object.defineProperty(window, "indexedDB", {
          value: origWindowIdb,
          configurable: true,
        });
      }
    }

    docA.destroy();
    docB.destroy();
  });
});