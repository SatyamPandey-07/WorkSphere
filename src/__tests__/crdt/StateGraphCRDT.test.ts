import { describe, it, expect, beforeEach } from 'vitest';
import { StateGraphCRDT } from '../../core/crdt/StateGraphCRDT';

describe('StateGraphCRDT - State-Based Conflict-Free Replicated Graph', () => {
  let graphA: StateGraphCRDT;
  let graphB: StateGraphCRDT;

  beforeEach(() => {
    graphA = new StateGraphCRDT({ replicaId: 'node-A', enforceAcyclic: true });
    graphB = new StateGraphCRDT({ replicaId: 'node-B', enforceAcyclic: true });
  });

  describe('Add-Wins (OR-Set) Vertex & Edge Semantics', () => {
    it('adds and removes vertices with Add-Wins conflict resolution', () => {
      graphA.addVertex('desk-1', 'Hot Desk 1', { capacity: 1 });
      expect(graphA.hasVertex('desk-1')).toBe(true);

      const delDelta = graphA.removeVertex('desk-1');
      expect(graphA.hasVertex('desk-1')).toBe(false);

      // Re-add concurrently wins over earlier deletion
      graphA.addVertex('desk-1', 'Hot Desk 1 Renewed');
      expect(graphA.hasVertex('desk-1')).toBe(true);

      // Re-applying old remove delta does not remove the newer add
      graphA.mergeDelta(delDelta);
      expect(graphA.hasVertex('desk-1')).toBe(true);
    });

    it('deactivates incident edges when an endpoint vertex is deleted', () => {
      graphA.addVertex('zone-1');
      graphA.addVertex('desk-1');
      graphA.addEdge('zone-1', 'desk-1');

      expect(graphA.hasEdge('zone-1', 'desk-1')).toBe(true);

      graphA.removeVertex('zone-1');
      expect(graphA.hasVertex('zone-1')).toBe(false);
      expect(graphA.hasEdge('zone-1', 'desk-1')).toBe(false);
    });
  });

  describe('Delta Replication & Strong Eventual Consistency', () => {
    it('achieves identical state after bidirectional delta merges', () => {
      // Node A adds V1, V2 and edge V1->V2
      const deltaA1 = graphA.addVertex('v1', 'Vertex 1');
      const deltaA2 = graphA.addVertex('v2', 'Vertex 2');
      const { delta: deltaA3 } = graphA.addEdge('v1', 'v2');

      // Node B adds V3 and edge V2->V3 (after receiving V2)
      graphB.mergeDelta(deltaA1);
      graphB.mergeDelta(deltaA2);
      graphB.mergeDelta(deltaA3);

      const deltaB1 = graphB.addVertex('v3', 'Vertex 3');
      const { delta: deltaB2 } = graphB.addEdge('v2', 'v3');

      // Sync back to A
      graphA.mergeDelta(deltaB1);
      graphA.mergeDelta(deltaB2);

      expect(graphA.getActiveVertices().length).toBe(3);
      expect(graphB.getActiveVertices().length).toBe(3);
      expect(graphA.getActiveEdges().length).toBe(2);
      expect(graphB.getActiveEdges().length).toBe(2);
      expect(graphA.hasPath('v1', 'v3')).toBe(true);
      expect(graphB.hasPath('v1', 'v3')).toBe(true);
    });
  });

  describe('DAG Cycle Detection & Topological Ordering', () => {
    it('prevents cycle formation when enforceAcyclic is enabled', () => {
      graphA.addVertex('step-1');
      graphA.addVertex('step-2');
      graphA.addVertex('step-3');

      graphA.addEdge('step-1', 'step-2');
      graphA.addEdge('step-2', 'step-3');

      // Attempt step-3 -> step-1 (would create cycle step-1 -> step-2 -> step-3 -> step-1)
      const res = graphA.addEdge('step-3', 'step-1');
      expect(res.success).toBe(false);
      expect(res.cycleRejected).toBe(true);
      expect(graphA.hasEdge('step-3', 'step-1')).toBe(false);

      const sorted = graphA.topologicalSort();
      expect(sorted).toEqual(['step-1', 'step-2', 'step-3']);
    });
  });
});
