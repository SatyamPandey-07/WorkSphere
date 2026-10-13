import {
  ClipboardCRDT,
  OpIdTuple,
  UndoOperation,
} from "@/core/crdt/ClipboardCRDT";

describe("ClipboardCRDT Undo/Redo Engine", () => {
  describe("Operation ID Tuples in Undo/Redo Buffer", () => {
    it("tracks operation ID tuples (clientId, lamportClock) in the undo buffer", () => {
      const crdt = new ClipboardCRDT("client-device-1", 10);
      crdt.insert("a");

      const undoStack = crdt.getUndoStack();
      expect(undoStack).toHaveLength(1);

      const entry = undoStack[0];
      expect(Array.isArray(entry.opId)).toBe(true);
      expect(entry.opId).toHaveLength(2);
      expect(entry.opId[0]).toBe("client-device-1");
      expect(entry.opId[1]).toBe(11); // advanced from 10 to 11

      expect(Array.isArray(entry.targetId)).toBe(true);
      expect(entry.targetId).toEqual(["client-device-1", 11]);
      expect(entry.type).toBe("insert");
      expect(entry.char).toBe("a");
    });

    it("tracks operation ID tuples (clientId, lamportClock) in the redo buffer upon undo", () => {
      const crdt = new ClipboardCRDT("client-device-1", 0);
      crdt.insert("x");

      expect(crdt.getText()).toBe("x");
      const undone = crdt.undo();
      expect(undone).not.toBeNull();
      expect(crdt.getText()).toBe("");

      const redoStack = crdt.getRedoStack();
      expect(redoStack).toHaveLength(1);
      const redoEntry = redoStack[0];
      expect(redoEntry.opId).toEqual(["client-device-1", 1]);
      expect(redoEntry.targetId).toEqual(["client-device-1", 1]);

      crdt.redo();
      expect(crdt.getText()).toBe("x");
      expect(crdt.getRedoStack()).toHaveLength(0);
      expect(crdt.getUndoStack()).toHaveLength(1);
    });
  });

  describe("State Vector Presence & Idempotent Tombstone Resolution", () => {
    it("verifies state vector presence before toggling tombstones", () => {
      const crdt = new ClipboardCRDT("client-local", 5);
      crdt.insert("h");

      // Attempt to apply an undo targeting an unknown client operation
      const missingTargetId: OpIdTuple = ["client-ghost", 42];
      expect(crdt.hasInStateVector(missingTargetId)).toBe(false);

      const fakeUndo: UndoOperation = {
        opId: ["client-ghost", 50],
        type: "insert",
        targetId: missingTargetId,
        char: "?",
      };

      const applied = crdt.applyRemoteUndo(fakeUndo);
      expect(applied).toBe(false);
      // Local text remains unaltered
      expect(crdt.getText()).toBe("h");
    });

    it("resolves duplicate concurrent undos idempotently without conflicts", () => {
      const crdt = new ClipboardCRDT("client-nomad-1", 0);
      crdt.insert("k");

      const undoEntry = crdt.getUndoStack()[0];

      // Undo locally
      const localUndo = crdt.undo();
      expect(localUndo).not.toBeNull();
      expect(crdt.getText()).toBe("");

      // Concurrent remote undo arriving for the same operation
      const remoteUndoApplied = crdt.applyRemoteUndo(undoEntry);
      expect(remoteUndoApplied).toBe(true);
      expect(crdt.getText()).toBe("");

      // Applying it again must be safe and idempotent
      const duplicateUndoApplied = crdt.applyRemoteUndo(undoEntry);
      expect(duplicateUndoApplied).toBe(true);
      expect(crdt.getText()).toBe("");

      // Exactly 1 character record exists in memory
      expect(crdt.getCharacters(true)).toHaveLength(1);
    });
  });

  describe("Integration: Two Clients Undoing Simultaneous Edits with Skewed Lamport Clocks", () => {
    it("simulates two clients undoing simultaneous edits without character duplicates upon redo", () => {
      // Client A has a low Lamport clock (5), Client B has skewed high clock (500)
      const clientA = new ClipboardCRDT("nomad-device-a", 5);
      const clientB = new ClipboardCRDT("nomad-device-b", 500);

      // Client A types 'A', Client B types 'B'
      const charA = clientA.insert("A");
      const charB = clientB.insert("B");

      expect(charA.id).toEqual(["nomad-device-a", 6]);
      expect(charB.id).toEqual(["nomad-device-b", 501]);

      // Synchronize initial state between both devices
      clientA.merge(clientB);
      clientB.merge(clientA);

      // Both clients converge on identical text
      expect(clientA.getText()).toBe(clientB.getText());
      const convergedText = clientA.getText();
      expect(convergedText).toHaveLength(2);

      // Both clients state vectors contain both operations
      expect(clientA.hasInStateVector(charA.id)).toBe(true);
      expect(clientA.hasInStateVector(charB.id)).toBe(true);
      expect(clientB.hasInStateVector(charA.id)).toBe(true);
      expect(clientB.hasInStateVector(charB.id)).toBe(true);

      // Devices perform simultaneous undo operations
      const undoA = clientA.undo();
      const undoB = clientB.undo();

      expect(undoA).not.toBeNull();
      expect(undoB).not.toBeNull();

      // Exchange and apply concurrent undos
      const appliedOnB = clientB.applyRemoteUndo(undoA!);
      const appliedOnA = clientA.applyRemoteUndo(undoB!);

      expect(appliedOnB).toBe(true);
      expect(appliedOnA).toBe(true);

      // Both clients reflect both edits being undone
      expect(clientA.getText()).toBe("");
      expect(clientB.getText()).toBe("");

      // Both devices perform redo operations
      const redoA = clientA.redo();
      const redoB = clientB.redo();

      expect(redoA).not.toBeNull();
      expect(redoB).not.toBeNull();

      // Exchange redos
      const redoAppliedOnB = clientB.applyRemoteRedo(redoA!);
      const redoAppliedOnA = clientA.applyRemoteRedo(redoB!);

      expect(redoAppliedOnB).toBe(true);
      expect(redoAppliedOnA).toBe(true);

      // Both clients converge back to the exact initial text
      expect(clientA.getText()).toBe(convergedText);
      expect(clientB.getText()).toBe(convergedText);

      // CRITICAL ASSERTION: No duplicate character records were generated
      // Both devices must have exactly 2 total character records
      expect(clientA.getCharacters(true)).toHaveLength(2);
      expect(clientB.getCharacters(true)).toHaveLength(2);
      expect(clientA.getText()).toHaveLength(2);
      expect(clientB.getText()).toHaveLength(2);
    });

    it("preserves backwards-compatibility with ClipboardItem registers and vector clocks", () => {
      const crdt = new ClipboardCRDT("test-device", 0);
      const item = crdt.addItem("text", "Shared snippet");

      expect(item.type).toBe("text");
      expect(item.content).toBe("Shared snippet");
      expect(crdt.getHistory()).toHaveLength(1);
      expect(crdt.getVectorClock()["test-device"]).toBeGreaterThanOrEqual(1);
    });
  });
});
