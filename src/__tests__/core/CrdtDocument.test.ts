/**
 * CrdtDocument.test.ts
 * Tests for CrdtDocument selective undo/redo history stack and deterministic convergence (#5310).
 */

import {
  CrdtDocument,
  CrdtOperation,
  encodeVarInt,
  decodeVarInt,
  encodeRleTombstones,
  decodeRleTombstones,
  extractTombstoneRanges,
  expandTombstoneRanges,
  encodeVectorClock,
  decodeVectorClock,
  encodeStateBinary,
  decodeStateBinary,
  TombstoneRange,
} from "@/core/crdt/CrdtDocument";

describe("CrdtDocument Selective Undo/Redo (#5310)", () => {
  describe("Basic Local Undo & Redo", () => {
    it("inverts local ADD_TEXT operation by generating DELETE_ELEMENT with incremented vector clock", () => {
      const doc = new CrdtDocument("client-A");

      const op = doc.applyLocalOperation({
        id: "text-1",
        type: "ADD_TEXT",
        nodeId: "client-A",
        timestamp: 1000,
        payload: { text: "Hello World" },
      });

      expect(op.vectorClock["client-A"]).toBe(1);
      expect(doc.getElements()).toHaveLength(1);
      expect(doc.canUndo()).toBe(true);
      expect(doc.canRedo()).toBe(false);

      // Perform undo
      const undoOp = doc.undo();
      expect(undoOp).not.toBeNull();
      expect(undoOp?.id).toBe("text-1");
      expect(undoOp?.type).toBe("DELETE_ELEMENT");
      // Preserves vector clock causality: clock is monotonically incremented
      expect(undoOp?.vectorClock["client-A"]).toBe(2);
      expect(doc.getElements()).toHaveLength(0);
      expect(doc.getElements(true)[0].type).toBe("DELETE_ELEMENT");

      expect(doc.canUndo()).toBe(false);
      expect(doc.canRedo()).toBe(true);
    });

    it("inverts local UPDATE_TEXT operation by restoring previous payload", () => {
      const doc = new CrdtDocument("client-A");

      doc.applyLocalOperation({
        id: "text-1",
        type: "ADD_TEXT",
        nodeId: "client-A",
        timestamp: 1000,
        payload: { text: "Version 1" },
      });

      doc.applyLocalOperation({
        id: "text-1",
        type: "UPDATE_TEXT",
        nodeId: "client-A",
        timestamp: 2000,
        payload: { text: "Version 2" },
      });

      expect(doc.getElements()[0].payload.text).toBe("Version 2");

      // Undo should restore Version 1
      const undoOp = doc.undo();
      expect(undoOp?.type).toBe("ADD_TEXT");
      expect(undoOp?.payload.text).toBe("Version 1");
      expect(undoOp?.vectorClock["client-A"]).toBe(3);
      expect(doc.getElements()[0].payload.text).toBe("Version 1");

      // Redo should restore Version 2
      const redoOp = doc.redo();
      expect(redoOp?.type).toBe("UPDATE_TEXT");
      expect(redoOp?.payload.text).toBe("Version 2");
      expect(redoOp?.vectorClock["client-A"]).toBe(4);
      expect(doc.getElements()[0].payload.text).toBe("Version 2");
    });

    it("inverts local DELETE_ELEMENT operation by restoring previous element", () => {
      const doc = new CrdtDocument("client-A");

      doc.applyLocalOperation({
        id: "stroke-1",
        type: "DRAW_STROKE",
        nodeId: "client-A",
        timestamp: 1000,
        payload: { points: [0, 0, 10, 10] },
      });

      doc.applyLocalOperation({
        id: "stroke-1",
        type: "DELETE_ELEMENT",
        nodeId: "client-A",
        timestamp: 2000,
        payload: { targetId: "stroke-1" },
      });

      expect(doc.getElements()).toHaveLength(0);

      // Undo deletion restores the stroke
      const undoOp = doc.undo();
      expect(undoOp?.type).toBe("DRAW_STROKE");
      expect(undoOp?.payload.points).toEqual([0, 0, 10, 10]);
      expect(doc.getElements()).toHaveLength(1);
    });

    it("clears redo stack upon a new local operation", () => {
      const doc = new CrdtDocument("client-A");

      doc.applyLocalOperation({
        id: "stroke-1",
        type: "DRAW_STROKE",
        nodeId: "client-A",
        timestamp: 1000,
        payload: { points: [1, 2] },
      });

      doc.undo();
      expect(doc.canRedo()).toBe(true);

      // New local edit should invalidate redo
      doc.applyLocalOperation({
        id: "stroke-2",
        type: "DRAW_STROKE",
        nodeId: "client-A",
        timestamp: 2000,
        payload: { points: [3, 4] },
      });

      expect(doc.canRedo()).toBe(false);
      expect(doc.redo()).toBeNull();
    });

    it("returns null and does not throw when undo/redo stacks are empty", () => {
      const doc = new CrdtDocument("client-A");
      expect(doc.undo()).toBeNull();
      expect(doc.redo()).toBeNull();
    });

    it("enforces maxHistorySize limit on undo/redo stacks", () => {
      const doc = new CrdtDocument("client-A", undefined, 2);

      doc.applyLocalOperation({
        id: "1",
        type: "ADD_TEXT",
        nodeId: "client-A",
        timestamp: 1,
        payload: {},
      });
      doc.applyLocalOperation({
        id: "2",
        type: "ADD_TEXT",
        nodeId: "client-A",
        timestamp: 2,
        payload: {},
      });
      doc.applyLocalOperation({
        id: "3",
        type: "ADD_TEXT",
        nodeId: "client-A",
        timestamp: 3,
        payload: {},
      });

      const history = doc.getHistory();
      expect(history.undoCount).toBe(2);
    });
  });

  describe("Selective Undo with Concurrent Peer Edits", () => {
    it("undos local edits without reverting concurrent contributions from remote peers", () => {
      const docA = new CrdtDocument("client-A");
      const docB = new CrdtDocument("client-B");

      // Client A draws stroke-A
      const strokeA = docA.applyLocalOperation({
        id: "elem-A",
        type: "DRAW_STROKE",
        nodeId: "client-A",
        timestamp: 1000,
        payload: { color: "blue" },
      });

      // Client B adds text-B concurrently
      const textB = docB.applyLocalOperation({
        id: "elem-B",
        type: "ADD_TEXT",
        nodeId: "client-B",
        timestamp: 1005,
        payload: { text: "Peer Note" },
      });

      // Synchronize operations between A and B
      docA.mergeRemoteOperation(textB);
      docB.mergeRemoteOperation(strokeA);

      // Both clients see both elements
      expect(docA.getElements()).toHaveLength(2);
      expect(docB.getElements()).toHaveLength(2);

      // Client A undos their own local edit
      const undoOpA = docA.undo();
      expect(undoOpA).not.toBeNull();
      expect(undoOpA?.id).toBe("elem-A");

      // Client A's document has undone elem-A, but KEPT Client B's elem-B!
      const activeA = docA.getElements();
      expect(activeA).toHaveLength(1);
      expect(activeA[0].id).toBe("elem-B");
      expect(activeA[0].payload.text).toBe("Peer Note");

      // Broadcast undo operation to Client B
      const mergedB = docB.mergeRemoteOperation(undoOpA as CrdtOperation);
      expect(mergedB).toBe(true);

      // Client B has also deterministically converged to only elem-B!
      const activeB = docB.getElements();
      expect(activeB).toHaveLength(1);
      expect(activeB[0].id).toBe("elem-B");
      expect(activeB[0].payload.text).toBe("Peer Note");
    });

    it("retains deterministic convergence when both clients undo and redo concurrently", () => {
      const docA = new CrdtDocument("client-A");
      const docB = new CrdtDocument("client-B");

      // A creates elem-1
      const opA = docA.applyLocalOperation({
        id: "elem-1",
        type: "ADD_TEXT",
        nodeId: "client-A",
        timestamp: 100,
        payload: { text: "Initial A" },
      });
      docB.mergeRemoteOperation(opA);

      // B creates elem-2
      const opB = docB.applyLocalOperation({
        id: "elem-2",
        type: "ADD_TEXT",
        nodeId: "client-B",
        timestamp: 110,
        payload: { text: "Initial B" },
      });
      docA.mergeRemoteOperation(opB);

      // A undos elem-1
      const undoA = docA.undo();
      // B undos elem-2
      const undoB = docB.undo();

      // Cross-replicate undos
      docA.mergeRemoteOperation(undoB as CrdtOperation);
      docB.mergeRemoteOperation(undoA as CrdtOperation);

      // Both documents are now empty of active elements
      expect(docA.getElements()).toHaveLength(0);
      expect(docB.getElements()).toHaveLength(0);

      // A redoes elem-1
      const redoA = docA.redo();
      docB.mergeRemoteOperation(redoA as CrdtOperation);

      expect(docA.getElements()).toHaveLength(1);
      expect(docB.getElements()).toHaveLength(1);
      expect(docA.getElements()[0].id).toBe("elem-1");
      expect(docB.getElements()[0].id).toBe("elem-1");

      // Deterministic state convergence: element maps match exactly
      expect(docA.getState().elements["elem-1"]).toEqual(
        docB.getState().elements["elem-1"],
      );
      expect(docA.getState().elements["elem-2"]).toEqual(
        docB.getState().elements["elem-2"],
      );
    });
  });

  describe("VarInt Variable-Length Integer Encoding & Decoding", () => {
    it("encodes integers < 128 into a single byte", () => {
      const b0 = encodeVarInt(0);
      expect(b0.length).toBe(1);
      expect(b0[0]).toBe(0);
      expect(decodeVarInt(b0).value).toBe(0);

      const b1 = encodeVarInt(1);
      expect(b1.length).toBe(1);
      expect(b1[0]).toBe(1);
      expect(decodeVarInt(b1).value).toBe(1);

      const b127 = encodeVarInt(127);
      expect(b127.length).toBe(1);
      expect(b127[0]).toBe(127);
      expect(decodeVarInt(b127).value).toBe(127);
    });

    it("encodes multi-byte numbers correctly across 7-bit boundaries", () => {
      const testCases = [128, 129, 255, 300, 16383, 16384, 65535, 1000000];
      for (const num of testCases) {
        const encoded = encodeVarInt(num);
        const { value, bytesRead } = decodeVarInt(encoded);
        expect(value).toBe(num);
        expect(bytesRead).toBe(encoded.length);
      }
    });

    it("accurately encodes and decodes large Lamport timestamps and millisecond epochs", () => {
      const timestamps = [
        1700000000000,
        1728691200000,
        9007199254740000, // Close to MAX_SAFE_INTEGER
      ];
      for (const ts of timestamps) {
        const encoded = encodeVarInt(ts);
        const { value } = decodeVarInt(encoded);
        expect(value).toBe(ts);
      }
    });

    it("throws when decoding truncated or empty buffers", () => {
      expect(() => decodeVarInt(new Uint8Array([]))).toThrow(
        "Unexpected end of buffer",
      );
      // 0x80 indicates continuation bit set, but buffer ends abruptly
      expect(() => decodeVarInt(new Uint8Array([0x80]))).toThrow(
        "Unexpected end of buffer",
      );
    });

    it("rejects negative integers", () => {
      expect(() => encodeVarInt(-1)).toThrow(
        "only supports non-negative integers",
      );
    });
  });

  describe("VectorClock VarInt Encoding", () => {
    it("encodes and decodes vector clocks using VarInt client IDs and Lamport clocks", () => {
      const clock = {
        "client-alpha": 42,
        "client-beta": 1337,
        "client-gamma": 0,
      };

      const encoded = encodeVectorClock(clock);
      const { vectorClock } = decodeVectorClock(encoded);

      expect(vectorClock).toEqual(clock);
    });

    it("uses shared string table indices to compress client IDs", () => {
      const stringTable = ["client-A", "client-B", "client-C"];
      const clock = {
        "client-A": 100,
        "client-B": 250,
        "client-C": 500,
      };

      const encoded = encodeVectorClock(clock, stringTable);
      const { vectorClock } = decodeVectorClock(encoded, 0, stringTable);

      expect(vectorClock).toEqual(clock);
    });
  });

  describe("RLE Tombstone Range Compression", () => {
    it("compresses contiguous character deletion tombstones into a single TombstoneRange", () => {
      const tombstones: CrdtOperation[] = [];
      const baseTime = 1700000000000;

      // 100 contiguous character deletions: char-0 through char-99
      for (let i = 0; i < 100; i++) {
        tombstones.push({
          id: `char-${i}`,
          type: "DELETE_ELEMENT",
          nodeId: "client-A",
          timestamp: baseTime + i * 10,
          vectorClock: { "client-A": i + 1 },
          payload: { targetId: `char-${i}` },
        });
      }

      const ranges = extractTombstoneRanges(tombstones);
      expect(ranges).toHaveLength(1);
      expect(ranges[0].nodeId).toBe("client-A");
      expect(ranges[0].idPrefix).toBe("char-");
      expect(ranges[0].startSeq).toBe(0);
      expect(ranges[0].count).toBe(100);
      expect(ranges[0].startTimestamp).toBe(baseTime);
      expect(ranges[0].stepTimestamp).toBe(10);

      // Expand back and verify exact operation restoration
      const expanded = expandTombstoneRanges(ranges);
      expect(expanded).toHaveLength(100);
      expect(expanded[0].id).toBe("char-0");
      expect(expanded[99].id).toBe("char-99");
      expect(expanded[50].nodeId).toBe("client-A");
      expect(expanded[50].timestamp).toBe(baseTime + 50 * 10);
      expect(expanded[50].payload.targetId).toBe("char-50");
    });

    it("splits non-contiguous deletion bursts into separate ranges", () => {
      const tombstones: CrdtOperation[] = [
        // Range 1: char-0 to char-4
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `char-${i}`,
          type: "DELETE_ELEMENT" as const,
          nodeId: "client-A",
          timestamp: 1000 + i,
          vectorClock: { "client-A": i + 1 },
          payload: { targetId: `char-${i}` },
        })),
        // Range 2: gap, then char-50 to char-54
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `char-${50 + i}`,
          type: "DELETE_ELEMENT" as const,
          nodeId: "client-A",
          timestamp: 2000 + i,
          vectorClock: { "client-A": 51 + i },
          payload: { targetId: `char-${50 + i}` },
        })),
      ];

      const ranges = extractTombstoneRanges(tombstones);
      expect(ranges).toHaveLength(2);
      expect(ranges[0].startSeq).toBe(0);
      expect(ranges[0].count).toBe(5);
      expect(ranges[1].startSeq).toBe(50);
      expect(ranges[1].count).toBe(5);
    });

    it("encodes and decodes TombstoneRange array with VarInt and RLE", () => {
      const ranges: TombstoneRange[] = [
        {
          nodeId: "user-1",
          idPrefix: "c-",
          targetIdPrefix: "c-",
          startSeq: 100,
          count: 50,
          startTimestamp: 1720000000000,
          stepTimestamp: 5,
          hasDigits: true,
        },
        {
          nodeId: "user-2",
          idPrefix: "shape_",
          targetIdPrefix: "shape_",
          startSeq: 1,
          count: 20,
          startTimestamp: 1720000050000,
          stepTimestamp: 2,
          hasDigits: true,
        },
      ];

      const encoded = encodeRleTombstones(ranges);
      const { ranges: decoded } = decodeRleTombstones(encoded);

      expect(decoded).toHaveLength(2);
      expect(decoded[0].nodeId).toBe("user-1");
      expect(decoded[0].startSeq).toBe(100);
      expect(decoded[0].count).toBe(50);
      expect(decoded[1].nodeId).toBe("user-2");
      expect(decoded[1].count).toBe(20);
    });
  });

  describe("Full Binary State Serialization Round-trip", () => {
    it("serializes and deserializes full document state preserving active items, tombstones, and clocks", () => {
      const doc = new CrdtDocument("client-main");

      // Add active text and stroke
      doc.applyLocalOperation({
        id: "header-text",
        type: "ADD_TEXT",
        nodeId: "client-main",
        timestamp: 1000,
        payload: { text: "Title Document" },
      });

      doc.applyLocalOperation({
        id: "stroke-1",
        type: "DRAW_STROKE",
        nodeId: "client-main",
        timestamp: 1100,
        payload: { points: [10, 20, 30, 40] },
      });

      // Add 25 contiguous tombstones
      for (let i = 0; i < 25; i++) {
        doc.applyLocalOperation({
          id: `draft-char-${i}`,
          type: "DELETE_ELEMENT",
          nodeId: "client-main",
          timestamp: 1200 + i,
          payload: { targetId: `draft-char-${i}` },
        });
      }

      const binary = doc.encodeBinary();
      expect(binary[0]).toBe(0x57); // 'W'
      expect(binary[1]).toBe(0x53); // 'S'
      expect(binary[2]).toBe(1); // Version 1

      const restoredDoc = CrdtDocument.fromBinary(binary, "restored-client");

      // Active elements are preserved
      const activeElements = restoredDoc.getElements();
      expect(activeElements).toHaveLength(2);
      expect(
        activeElements.find((e) => e.id === "header-text")?.payload.text,
      ).toBe("Title Document");

      // Tombstones are preserved
      const allElements = restoredDoc.getElements(true);
      expect(allElements).toHaveLength(27);
      expect(
        allElements.filter((e) => e.type === "DELETE_ELEMENT"),
      ).toHaveLength(25);

      // Vector clock is preserved
      expect(restoredDoc.getState().vectorClock["client-main"]).toBe(27);
    });

    it("encodes and decodes raw CrdtState directly via encodeStateBinary and decodeStateBinary", () => {
      const doc = new CrdtDocument("direct-client");
      doc.applyLocalOperation({
        id: "elem-direct",
        type: "ADD_TEXT",
        nodeId: "direct-client",
        timestamp: 500,
        payload: { text: "Direct Encode" },
      });

      const state = doc.getState();
      const binary = encodeStateBinary(state);
      const decoded = decodeStateBinary(binary);

      expect(decoded.vectorClock).toEqual(state.vectorClock);
      expect(Object.keys(decoded.elements)).toHaveLength(1);
      expect(decoded.elements["elem-direct"].payload.text).toBe(
        "Direct Encode",
      );
    });
  });

  describe("Benchmark Payload Size Reduction (>= 60% requirement)", () => {
    it("achieves > 60% payload size reduction on 1,000 contiguous character deletions", () => {
      const doc = new CrdtDocument("editor-client");
      const baseTime = 1700000000000;

      for (let i = 0; i < 1000; i++) {
        doc.applyLocalOperation({
          id: `char-${i}`,
          type: "DELETE_ELEMENT",
          nodeId: "editor-client",
          timestamp: baseTime + i * 5,
          payload: { targetId: `char-${i}` },
        });
      }

      const rawJson = JSON.stringify(doc.getState());
      const rawJsonBytes = new TextEncoder().encode(rawJson).byteLength;

      const compressedBinary = doc.encodeBinary();
      const compressedBytes = compressedBinary.byteLength;

      const reductionPercentage =
        ((rawJsonBytes - compressedBytes) / rawJsonBytes) * 100;

      // Acceptance criterion: Verify at least 60% reduction in serialized binary state payload size
      expect(reductionPercentage).toBeGreaterThanOrEqual(60);
      // In practice, RLE over contiguous deletions yields > 98% reduction
      expect(reductionPercentage).toBeGreaterThan(90);
      expect(compressedBytes).toBeLessThan(rawJsonBytes * 0.4);
    });

    it("achieves > 60% reduction in multi-peer collaborative editing session with fragmented deletion bursts", () => {
      const doc = new CrdtDocument("coordinator");
      const baseTime = 1710000000000;
      const peers = [
        "peer-alice",
        "peer-bob",
        "peer-charlie",
        "peer-dave",
        "peer-eve",
      ];

      // Each peer deletes 100 contiguous characters
      for (const peer of peers) {
        for (let i = 0; i < 100; i++) {
          doc.mergeRemoteOperation({
            id: `${peer}-tok-${i}`,
            type: "DELETE_ELEMENT",
            nodeId: peer,
            timestamp: baseTime + i * 10,
            vectorClock: { [peer]: i + 1 },
            payload: { targetId: `${peer}-tok-${i}` },
          });
        }
      }

      const rawJsonBytes = new TextEncoder().encode(
        JSON.stringify(doc.getState()),
      ).byteLength;
      const compressedBytes = doc.encodeBinary().byteLength;

      const reductionPercentage =
        ((rawJsonBytes - compressedBytes) / rawJsonBytes) * 100;

      expect(reductionPercentage).toBeGreaterThanOrEqual(60);
      expect(reductionPercentage).toBeGreaterThan(85);
    });

    it("achieves > 60% reduction on mixed document with active canvas elements and dense tombstones", () => {
      const doc = new CrdtDocument("canvas-peer");

      // 20 active shapes
      for (let s = 0; s < 20; s++) {
        doc.applyLocalOperation({
          id: `shape-${s}`,
          type: "DRAW_STROKE",
          nodeId: "canvas-peer",
          timestamp: 1000 + s,
          payload: { points: [s, s * 2, s * 3, s * 4], color: "#ff0000" },
        });
      }

      // 500 contiguous deleted draft strokes/characters
      for (let d = 0; d < 500; d++) {
        doc.applyLocalOperation({
          id: `draft-${d}`,
          type: "DELETE_ELEMENT",
          nodeId: "canvas-peer",
          timestamp: 2000 + d,
          payload: { targetId: `draft-${d}` },
        });
      }

      const rawJsonBytes = new TextEncoder().encode(
        JSON.stringify(doc.getState()),
      ).byteLength;
      const compressedBytes = doc.encodeBinary().byteLength;

      const reductionPercentage =
        ((rawJsonBytes - compressedBytes) / rawJsonBytes) * 100;

      expect(reductionPercentage).toBeGreaterThanOrEqual(60);
    });
  });
});
