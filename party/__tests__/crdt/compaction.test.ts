import * as Y from "yjs";
import { NomadCanvasProvider } from "@/lib/crdt/canvasProvider";

describe("Yjs CRDT Document Compaction & State Integrity", () => {
  test("compacts multi-stroke transactions without losing document state", () => {
    const provider1 = new NomadCanvasProvider("test-room");
    const strokes = provider1.doc.getArray("strokes");

    // Simulate 600 continuous drawing operation updates
    for (let i = 0; i < 600; i++) {
      provider1.doc.transact(() => {
        strokes.push([{ id: `stroke-${i}`, x: i * 2, y: i * 3 }]);
      });
    }

    expect(strokes.length).toBe(600);

    // Encode compacted snapshot update
    const compactedUpdate = provider1.compactState();

    // Verify a fresh joining peer document receiving only the compacted snapshot matches state perfectly
    const peerDoc = new Y.Doc();
    Y.applyUpdate(peerDoc, compactedUpdate);

    const peerStrokes = peerDoc.getArray("strokes");
    expect(peerStrokes.length).toBe(600);
    expect(peerStrokes.get(599)).toEqual({ id: "stroke-599", x: 1198, y: 1797 });

    provider1.destroy();
    peerDoc.destroy();
  });
});