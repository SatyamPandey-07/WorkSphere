import * as Y from "yjs";
import {
  compressYjsUpdate,
  decompressYjsUpdate,
  getCompressionRatio,
  COMPRESSION_MAGIC_HEADER,
} from "@/lib/crdt/yjsCompression";

describe("Yjs Document Update Binary Compression (#1427)", () => {
  it("compresses Y.encodeStateAsUpdate payload by over 60% for typical whiteboard shape data", () => {
    const doc = new Y.Doc();
    const shapes = doc.getArray<Y.Map<unknown>>("shapes");

    // Populate document with realistic drawing shape data
    doc.transact(() => {
      for (let i = 0; i < 50; i++) {
        const shape = new Y.Map<unknown>();
        shape.set("id", `shape_${i}_${Date.now()}`);
        shape.set("type", "pen");
        shape.set("points", [
          10 + i * 2,
          20 + i * 3,
          15 + i * 2,
          25 + i * 3,
          30 + i * 2,
          35 + i * 3,
          45 + i * 2,
          50 + i * 3,
        ]);
        shape.set("color", "#f43f5e");
        shape.set("width", 5);
        shape.set("opacity", 0.95);
        shape.set("userId", "user_author_test_123");
        shapes.push([shape]);
      }
    });

    const originalUpdate = Y.encodeStateAsUpdate(doc);
    expect(originalUpdate.length).toBeGreaterThan(100);

    const compressed = compressYjsUpdate(originalUpdate);

    // Verify magic header is prepended
    expect(compressed.subarray(0, 4)).toEqual(COMPRESSION_MAGIC_HEADER);

    const ratio = getCompressionRatio(originalUpdate.length, compressed.length);
    expect(ratio).toBeGreaterThanOrEqual(60);

    doc.destroy();
  });

  it("losslessly decompresses update buffer allowing Y.applyUpdate to restore document state", () => {
    const docA = new Y.Doc();
    const shapesA = docA.getArray<Y.Map<unknown>>("shapes");

    docA.transact(() => {
      const shape = new Y.Map<unknown>();
      shape.set("id", "s1");
      shape.set("type", "rect");
      shape.set("points", [100, 100, 300, 200]);
      shape.set("color", "#22c55e");
      shape.set("width", 4);
      shapesA.push([shape]);
    });

    const originalUpdate = Y.encodeStateAsUpdate(docA);
    const compressed = compressYjsUpdate(originalUpdate);
    const decompressed = decompressYjsUpdate(compressed);

    // Apply decompressed update to secondary doc
    const docB = new Y.Doc();
    Y.applyUpdate(docB, decompressed);

    const shapesB = docB.getArray<Y.Map<unknown>>("shapes");
    expect(shapesB.length).toBe(1);
    expect(shapesB.get(0).get("id")).toBe("s1");
    expect(shapesB.get(0).get("color")).toBe("#22c55e");

    docA.destroy();
    docB.destroy();
  });

  it("benchmarks decompression overhead under 2ms per packet", () => {
    const doc = new Y.Doc();
    const shapes = doc.getArray<Y.Map<unknown>>("shapes");

    doc.transact(() => {
      for (let i = 0; i < 30; i++) {
        const shape = new Y.Map<unknown>();
        shape.set("id", `bench_shape_${i}`);
        shape.set(
          "points",
          Array.from({ length: 40 }, (_, idx) => idx * i),
        );
        shapes.push([shape]);
      }
    });

    const update = Y.encodeStateAsUpdate(doc);
    const compressed = compressYjsUpdate(update);

    const iterations = 100;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      decompressYjsUpdate(compressed);
    }
    const elapsed = performance.now() - start;
    const avgLatencyMs = elapsed / iterations;

    expect(avgLatencyMs).toBeLessThan(2.0);

    doc.destroy();
  });

  it("transparently passes through uncompressed packets lacking magic header", () => {
    const rawData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const result = decompressYjsUpdate(rawData);
    expect(result).toBe(rawData);
  });
});
