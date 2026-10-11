/**
 * CrdtDocument.test.ts
 * Tests for CrdtDocument selective undo/redo history stack and deterministic convergence (#5310).
 */

import { CrdtDocument, CrdtOperation } from '@/core/crdt/CrdtDocument';

describe('CrdtDocument Selective Undo/Redo (#5310)', () => {
  describe('Basic Local Undo & Redo', () => {
    it('inverts local ADD_TEXT operation by generating DELETE_ELEMENT with incremented vector clock', () => {
      const doc = new CrdtDocument('client-A');

      const op = doc.applyLocalOperation({
        id: 'text-1',
        type: 'ADD_TEXT',
        nodeId: 'client-A',
        timestamp: 1000,
        payload: { text: 'Hello World' },
      });

      expect(op.vectorClock['client-A']).toBe(1);
      expect(doc.getElements()).toHaveLength(1);
      expect(doc.canUndo()).toBe(true);
      expect(doc.canRedo()).toBe(false);

      // Perform undo
      const undoOp = doc.undo();
      expect(undoOp).not.toBeNull();
      expect(undoOp?.id).toBe('text-1');
      expect(undoOp?.type).toBe('DELETE_ELEMENT');
      // Preserves vector clock causality: clock is monotonically incremented
      expect(undoOp?.vectorClock['client-A']).toBe(2);
      expect(doc.getElements()).toHaveLength(0);
      expect(doc.getElements(true)[0].type).toBe('DELETE_ELEMENT');

      expect(doc.canUndo()).toBe(false);
      expect(doc.canRedo()).toBe(true);
    });

    it('inverts local UPDATE_TEXT operation by restoring previous payload', () => {
      const doc = new CrdtDocument('client-A');

      doc.applyLocalOperation({
        id: 'text-1',
        type: 'ADD_TEXT',
        nodeId: 'client-A',
        timestamp: 1000,
        payload: { text: 'Version 1' },
      });

      doc.applyLocalOperation({
        id: 'text-1',
        type: 'UPDATE_TEXT',
        nodeId: 'client-A',
        timestamp: 2000,
        payload: { text: 'Version 2' },
      });

      expect(doc.getElements()[0].payload.text).toBe('Version 2');

      // Undo should restore Version 1
      const undoOp = doc.undo();
      expect(undoOp?.type).toBe('ADD_TEXT');
      expect(undoOp?.payload.text).toBe('Version 1');
      expect(undoOp?.vectorClock['client-A']).toBe(3);
      expect(doc.getElements()[0].payload.text).toBe('Version 1');

      // Redo should restore Version 2
      const redoOp = doc.redo();
      expect(redoOp?.type).toBe('UPDATE_TEXT');
      expect(redoOp?.payload.text).toBe('Version 2');
      expect(redoOp?.vectorClock['client-A']).toBe(4);
      expect(doc.getElements()[0].payload.text).toBe('Version 2');
    });

    it('inverts local DELETE_ELEMENT operation by restoring previous element', () => {
      const doc = new CrdtDocument('client-A');

      doc.applyLocalOperation({
        id: 'stroke-1',
        type: 'DRAW_STROKE',
        nodeId: 'client-A',
        timestamp: 1000,
        payload: { points: [0, 0, 10, 10] },
      });

      doc.applyLocalOperation({
        id: 'stroke-1',
        type: 'DELETE_ELEMENT',
        nodeId: 'client-A',
        timestamp: 2000,
        payload: { targetId: 'stroke-1' },
      });

      expect(doc.getElements()).toHaveLength(0);

      // Undo deletion restores the stroke
      const undoOp = doc.undo();
      expect(undoOp?.type).toBe('DRAW_STROKE');
      expect(undoOp?.payload.points).toEqual([0, 0, 10, 10]);
      expect(doc.getElements()).toHaveLength(1);
    });

    it('clears redo stack upon a new local operation', () => {
      const doc = new CrdtDocument('client-A');

      doc.applyLocalOperation({
        id: 'stroke-1',
        type: 'DRAW_STROKE',
        nodeId: 'client-A',
        timestamp: 1000,
        payload: { points: [1, 2] },
      });

      doc.undo();
      expect(doc.canRedo()).toBe(true);

      // New local edit should invalidate redo
      doc.applyLocalOperation({
        id: 'stroke-2',
        type: 'DRAW_STROKE',
        nodeId: 'client-A',
        timestamp: 2000,
        payload: { points: [3, 4] },
      });

      expect(doc.canRedo()).toBe(false);
      expect(doc.redo()).toBeNull();
    });

    it('returns null and does not throw when undo/redo stacks are empty', () => {
      const doc = new CrdtDocument('client-A');
      expect(doc.undo()).toBeNull();
      expect(doc.redo()).toBeNull();
    });

    it('enforces maxHistorySize limit on undo/redo stacks', () => {
      const doc = new CrdtDocument('client-A', undefined, 2);

      doc.applyLocalOperation({ id: '1', type: 'ADD_TEXT', nodeId: 'client-A', timestamp: 1, payload: {} });
      doc.applyLocalOperation({ id: '2', type: 'ADD_TEXT', nodeId: 'client-A', timestamp: 2, payload: {} });
      doc.applyLocalOperation({ id: '3', type: 'ADD_TEXT', nodeId: 'client-A', timestamp: 3, payload: {} });

      const history = doc.getHistory();
      expect(history.undoCount).toBe(2);
    });
  });

  describe('Selective Undo with Concurrent Peer Edits', () => {
    it('undos local edits without reverting concurrent contributions from remote peers', () => {
      const docA = new CrdtDocument('client-A');
      const docB = new CrdtDocument('client-B');

      // Client A draws stroke-A
      const strokeA = docA.applyLocalOperation({
        id: 'elem-A',
        type: 'DRAW_STROKE',
        nodeId: 'client-A',
        timestamp: 1000,
        payload: { color: 'blue' },
      });

      // Client B adds text-B concurrently
      const textB = docB.applyLocalOperation({
        id: 'elem-B',
        type: 'ADD_TEXT',
        nodeId: 'client-B',
        timestamp: 1005,
        payload: { text: 'Peer Note' },
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
      expect(undoOpA?.id).toBe('elem-A');

      // Client A's document has undone elem-A, but KEPT Client B's elem-B!
      const activeA = docA.getElements();
      expect(activeA).toHaveLength(1);
      expect(activeA[0].id).toBe('elem-B');
      expect(activeA[0].payload.text).toBe('Peer Note');

      // Broadcast undo operation to Client B
      const mergedB = docB.mergeRemoteOperation(undoOpA as CrdtOperation);
      expect(mergedB).toBe(true);

      // Client B has also deterministically converged to only elem-B!
      const activeB = docB.getElements();
      expect(activeB).toHaveLength(1);
      expect(activeB[0].id).toBe('elem-B');
      expect(activeB[0].payload.text).toBe('Peer Note');
    });

    it('retains deterministic convergence when both clients undo and redo concurrently', () => {
      const docA = new CrdtDocument('client-A');
      const docB = new CrdtDocument('client-B');

      // A creates elem-1
      const opA = docA.applyLocalOperation({
        id: 'elem-1',
        type: 'ADD_TEXT',
        nodeId: 'client-A',
        timestamp: 100,
        payload: { text: 'Initial A' },
      });
      docB.mergeRemoteOperation(opA);

      // B creates elem-2
      const opB = docB.applyLocalOperation({
        id: 'elem-2',
        type: 'ADD_TEXT',
        nodeId: 'client-B',
        timestamp: 110,
        payload: { text: 'Initial B' },
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
      expect(docA.getElements()[0].id).toBe('elem-1');
      expect(docB.getElements()[0].id).toBe('elem-1');

      // Deterministic state convergence: element maps match exactly
      expect(docA.getState().elements['elem-1']).toEqual(docB.getState().elements['elem-1']);
      expect(docA.getState().elements['elem-2']).toEqual(docB.getState().elements['elem-2']);
    });
  });
});
