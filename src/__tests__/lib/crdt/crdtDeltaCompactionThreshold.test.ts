import * as Y from "yjs";
import { compactDeltaUpdatesWithThreshold } from "@/lib/crdt/snapshotManager";

describe("CRDT Delta Compaction & Bounded History", () => {
  it("preserves 100% of active canvas shapes/metadata and reduces payload size past threshold", () => {
    const sourceDoc = new Y.Doc();
    const shapes = sourceDoc.getMap<Record<string, unknown>>("shapes");
    const deltas: Uint8Array[] = [];

    sourceDoc.on("update", (update: Uint8Array) => {
      deltas.push(update);
    });

    // Simulate 40 incremental edits overwriting the same shape coordinates + adding final shapes
    for (let i = 0; i < 35; i++) {
      shapes.set("rect-1", { id: "rect-1", x: i * 10, y: i * 5, label: `Step ${i}` });
    }
    shapes.set("circle-2", { id: "circle-2", x: 300, y: 400, color: "#2563eb" });

    const result = compactDeltaUpdatesWithThreshold(deltas, {
      maxDeltaCount: 10,
      maxUndoHistory: 5,
    });

    expect(result.compacted).toBe(true);
    expect(result.afterBytes).toBeLessThan(result.beforeBytes);
    expect(result.retainedHistory).toHaveLength(5);

    // Apply compacted snapshot to a fresh peer Y.Doc and verify identical state
    const peerDoc = new Y.Doc();
    Y.applyUpdate(peerDoc, result.mergedUpdate);
    const peerShapes = peerDoc.getMap<Record<string, unknown>>("shapes");

    expect(peerShapes.get("rect-1")).toEqual({
      id: "rect-1",
      x: 340,
      y: 170,
      label: "Step 34",
    });
    expect(peerShapes.get("circle-2")).toEqual({
      id: "circle-2",
      x: 300,
      y: 400,
      color: "#2563eb",
    });
  });

  it("does not flag compaction when deltas remain below thresholds", () => {
    const doc = new Y.Doc();
    const deltas: Uint8Array[] = [];
    doc.on("update", (u: Uint8Array) => deltas.push(u));
    doc.getArray("items").insert(0, ["a", "b"]);

    const result = compactDeltaUpdatesWithThreshold(deltas, {
      maxDeltaCount: 25,
      maxTotalBytes: 64 * 1024,
    });

    expect(result.compacted).toBe(false);
    expect(result.retainedHistory).toHaveLength(1);
  });
});