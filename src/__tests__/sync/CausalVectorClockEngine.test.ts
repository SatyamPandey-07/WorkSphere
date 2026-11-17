import {
  CausalVectorClockEngine,
  CausalOrder,
  CausalMessage,
} from '../../core/sync/CausalVectorClockEngine';

describe('CausalVectorClockEngine', () => {
  describe('Static Causal Partial Ordering Comparison', () => {
    it('detects HAPPENED_BEFORE relationship', () => {
      const clockA = { nodeA: 1, nodeB: 0 };
      const clockB = { nodeA: 1, nodeB: 1 };
      expect(CausalVectorClockEngine.compare(clockA, clockB)).toBe('HAPPENED_BEFORE');
    });

    it('detects HAPPENED_AFTER relationship', () => {
      const clockA = { nodeA: 2, nodeB: 1 };
      const clockB = { nodeA: 1, nodeB: 1 };
      expect(CausalVectorClockEngine.compare(clockA, clockB)).toBe('HAPPENED_AFTER');
    });

    it('detects CONCURRENT relationship when updates branch concurrently', () => {
      const clockA = { nodeA: 2, nodeB: 0 };
      const clockB = { nodeA: 1, nodeB: 1 };
      expect(CausalVectorClockEngine.compare(clockA, clockB)).toBe('CONCURRENT');
    });

    it('detects IDENTICAL relationship for equivalent clocks', () => {
      const clockA = { nodeA: 3, nodeB: 2 };
      const clockB = { nodeA: 3, nodeB: 2 };
      expect(CausalVectorClockEngine.compare(clockA, clockB)).toBe('IDENTICAL');
    });

    it('merges vector clocks by pairwise component-wise maximum', () => {
      const clockA = { nodeA: 3, nodeB: 1, nodeC: 0 };
      const clockB = { nodeA: 1, nodeB: 4, nodeD: 2 };
      const merged = CausalVectorClockEngine.merge(clockA, clockB);
      expect(merged).toEqual({
        nodeA: 3,
        nodeB: 4,
        nodeC: 0,
        nodeD: 2,
      });
    });
  });

  describe('Local Mutation & Event Generation', () => {
    it('increments local counter and attaches vector clock to emitted message', () => {
      const engine = new CausalVectorClockEngine<string>('nodeA');
      const msg1 = engine.createLocalEvent('ev-1', 'mutation A1');
      expect(msg1.vectorClock).toEqual({ nodeA: 1 });

      const msg2 = engine.createLocalEvent('ev-2', 'mutation A2');
      expect(msg2.vectorClock).toEqual({ nodeA: 2 });
      expect(engine.getLocalClock()).toEqual({ nodeA: 2 });
    });
  });

  describe('Causal Message Buffering & Cascade Delivery', () => {
    let nodeA: CausalVectorClockEngine<string>;
    let nodeB: CausalVectorClockEngine<string>;
    let nodeC: CausalVectorClockEngine<string>;

    beforeEach(() => {
      nodeA = new CausalVectorClockEngine<string>('nodeA');
      nodeB = new CausalVectorClockEngine<string>('nodeB');
      nodeC = new CausalVectorClockEngine<string>('nodeC');
    });

    it('delivers messages immediately when causal dependencies are already met', () => {
      // Node A creates an event
      const msgA1 = nodeA.createLocalEvent('msg-a1', 'hello from A');

      // Node B receives it
      const delivered = nodeB.receive(msgA1);
      expect(delivered.length).toBe(1);
      expect(delivered[0].id).toBe('msg-a1');
      expect(nodeB.getLocalClock().nodeA).toBe(1);
    });

    it('buffers out-of-order messages and cascades delivery once predecessors arrive', () => {
      // Node A creates event 1
      const msgA1 = nodeA.createLocalEvent('msg-a1', 'first event from A');
      // Node A creates event 2
      const msgA2 = nodeA.createLocalEvent('msg-a2', 'second event from A');

      // Node B receives msgA2 FIRST (network delay of msgA1)
      const deliveredPremature = nodeB.receive(msgA2);
      expect(deliveredPremature.length).toBe(0); // Not delivered yet!
      expect(nodeB.getBufferedCount()).toBe(1);

      // Now Node B receives msgA1
      const deliveredCascade = nodeB.receive(msgA1);
      expect(deliveredCascade.length).toBe(2);
      expect(deliveredCascade[0].id).toBe('msg-a1');
      expect(deliveredCascade[1].id).toBe('msg-a2');
      expect(nodeB.getBufferedCount()).toBe(0);
      expect(nodeB.getLocalClock().nodeA).toBe(2);
    });

    it('handles transitive 3-node causal chain delivery', () => {
      // Node A generates event
      const msgA1 = nodeA.createLocalEvent('msg-a1', 'init');

      // Node B receives A1, then generates B1 causally dependent on A1
      nodeB.receive(msgA1);
      const msgB1 = nodeB.createLocalEvent('msg-b1', 'reply to A');
      expect(msgB1.vectorClock).toEqual({ nodeA: 1, nodeB: 1 });

      // Node C receives B1 BEFORE receiving A1
      const deliveredC1 = nodeC.receive(msgB1);
      expect(deliveredC1.length).toBe(0); // C cannot deliver B1 because it hasn't seen A1!
      expect(nodeC.getBufferedCount()).toBe(1);

      // Node C finally receives A1
      const deliveredC2 = nodeC.receive(msgA1);
      expect(deliveredC2.length).toBe(2);
      expect(deliveredC2.map((m) => m.id)).toEqual(['msg-a1', 'msg-b1']);
      expect(nodeC.getBufferedCount()).toBe(0);
    });

    it('ignores stale or duplicate messages', () => {
      const msgA1 = nodeA.createLocalEvent('msg-a1', 'test');
      nodeB.receive(msgA1);

      // Re-send msgA1
      const duplicateDeliver = nodeB.receive(msgA1);
      expect(duplicateDeliver.length).toBe(0);
      expect(nodeB.getBufferedCount()).toBe(0);
    });
  });

  describe('Stability Horizon & Garbage Collection', () => {
    it('computes component-wise minimum across active peers', () => {
      const engine = new CausalVectorClockEngine<string>('nodeA', { nodeA: 5, nodeB: 4 });
      engine.addPeer('nodeB');

      // Receive message from Node B with vector { nodeA: 3, nodeB: 4 }
      engine.receive({
        id: 'msg-b1',
        senderId: 'nodeB',
        vectorClock: { nodeA: 3, nodeB: 1 },
        payload: 'peer heartbeat',
        timestamp: Date.now(),
      });

      const horizon = engine.computeStabilityHorizon();
      expect(horizon.horizonClock.nodeA).toBe(3);
    });

    it('updates stability horizon when peer is removed', () => {
      const engine = new CausalVectorClockEngine<string>('nodeA', { nodeA: 10 });
      engine.addPeer('offlinePeer');
      engine.removePeer('offlinePeer');
      const horizon = engine.computeStabilityHorizon();
      expect(horizon.horizonClock.nodeA).toBe(10);
    });
  });
});
