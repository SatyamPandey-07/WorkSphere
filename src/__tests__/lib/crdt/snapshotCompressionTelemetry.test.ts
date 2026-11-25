import * as Y from "yjs";
import { compressYjsUpdate } from "@/lib/crdt/yjsCompression";
import {
  decompressSnapshot,
  isCompressedPayload,
  type StoredSnapshot,
} from "@/lib/crdt/snapshotManager";
import {
  computeCompressionRatio,
  getCompressionTelemetry,
  recordCompression,
  resetCompressionTelemetry,
} from "@/lib/crdt/compressionTelemetry";

describe("Snapshot compression telemetry (#8015)", () => {
  beforeEach(() => resetCompressionTelemetry());

  it("computes ratio = 1 - compressed/raw and guards against zero raw size", () => {
    expect(computeCompressionRatio(1000, 250)).toBeCloseTo(0.75);
    expect(computeCompressionRatio(1000, 1000)).toBe(0);
    expect(computeCompressionRatio(0, 0)).toBe(0);
  });

  it("aggregates bytes, duration and ratio across compressions", () => {
    recordCompression(1000, 400, 2);
    recordCompression(3000, 600, 4);

    const t = getCompressionTelemetry();
    expect(t.compressionOps).toBe(2);
    expect(t.rawBytesCompressed).toBe(4000);
    expect(t.compressedBytes).toBe(1000);
    expect(t.compressionMs).toBe(6);
    expect(t.compressionRatio).toBeCloseTo(0.75);
    expect(t.lastCompressionRatio).toBeCloseTo(0.8);
  });

  it("resets all counters", () => {
    recordCompression(1000, 400, 2);
    resetCompressionTelemetry();
    expect(getCompressionTelemetry()).toMatchObject({
      compressionOps: 0,
      rawBytesCompressed: 0,
      compressionRatio: 0,
    });
  });

  it("records a decompression with a non-negative duration", () => {
    const doc = new Y.Doc();
    doc.getText("t").insert(0, "a".repeat(5000));
    const raw = Y.encodeStateAsUpdate(doc);
    const compressed = compressYjsUpdate(raw);
    expect(isCompressedPayload(compressed)).toBe(true);

    const snapshot = {
      roomId: "telemetry-room",
      update: compressed,
      stateVector: Y.encodeStateVector(doc),
      checksum: "unused",
      opsAtSnapshot: 1,
      createdAt: Date.now(),
      isCompressed: true,
      uncompressedSize: raw.length,
    } as StoredSnapshot;

    const restored = decompressSnapshot(snapshot);
    expect(restored.update.length).toBe(raw.length);

    const t = getCompressionTelemetry();
    expect(t.decompressionOps).toBe(1);
    expect(t.decompressionMs).toBeGreaterThanOrEqual(0);
  });

  it("does not record a decompression for an already-uncompressed snapshot", () => {
    const doc = new Y.Doc();
    doc.getText("t").insert(0, "hi");
    const snapshot = {
      roomId: "telemetry-room",
      update: Y.encodeStateAsUpdate(doc),
      stateVector: Y.encodeStateVector(doc),
      checksum: "unused",
      opsAtSnapshot: 1,
      createdAt: Date.now(),
    } as StoredSnapshot;

    decompressSnapshot(snapshot);
    expect(getCompressionTelemetry().decompressionOps).toBe(0);
  });
});
