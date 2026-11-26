/**
 * @file DeltaCRDTStore.test.ts
 * @description Comprehensive unit test suite for state-based delta-mutator CRDT store,
 * dot context tracking, semilattice merge commutativity, MVR, OR-Set, and LWW dictionary.
 */

import {
  DeltaCRDTStore,
  DotContext,
  type Dot,
  type DeltaGroup
} from '../../core/crdt/DeltaCRDTStore';

describe('DeltaCRDTStore & Distributed State Synchronization Engine', () => {
  describe('DotContext', () => {
    it('allocates sequential dots per replica and tracks causal order', () => {
      const ctx = new DotContext();
      const dot1 = ctx.makeDot('replica-A');
      const dot2 = ctx.makeDot('replica-A');
      const dotB1 = ctx.makeDot('replica-B');

      expect(dot1).toEqual({ replicaId: 'replica-A', counter: 1 });
      expect(dot2).toEqual({ replicaId: 'replica-A', counter: 2 });
      expect(dotB1).toEqual({ replicaId: 'replica-B', counter: 1 });

      expect(ctx.has(dot1)).toBe(true);
      expect(ctx.has(dot2)).toBe(true);
      expect(ctx.has(dotB1)).toBe(true);
      expect(ctx.has({ replicaId: 'replica-A', counter: 3 })).toBe(false);
    });

    it('compacts non-contiguous dots as gaps are filled', () => {
      const ctx = new DotContext();
      ctx.add({ replicaId: 'node-1', counter: 1 });
      ctx.add({ replicaId: 'node-1', counter: 3 }); // gap at 2

      expect(ctx.getVersionVector()['node-1']).toBe(1);
      expect(ctx.has({ replicaId: 'node-1', counter: 3 })).toBe(true);
      expect(ctx.has({ replicaId: 'node-1', counter: 2 })).toBe(false);

      // Now fill the gap
      ctx.add({ replicaId: 'node-1', counter: 2 });
      expect(ctx.getVersionVector()['node-1']).toBe(3);
    });

    it('correctly joins two independent dot contexts (lattice join)', () => {
      const ctx1 = new DotContext();
      ctx1.add({ replicaId: 'A', counter: 1 });
      ctx1.add({ replicaId: 'A', counter: 2 });
      ctx1.add({ replicaId: 'B', counter: 1 });

      const ctx2 = new DotContext();
      ctx2.add({ replicaId: 'A', counter: 1 });
      ctx2.add({ replicaId: 'B', counter: 3 });

      ctx1.join(ctx2);
      expect(ctx1.has({ replicaId: 'A', counter: 2 })).toBe(true);
      expect(ctx1.has({ replicaId: 'B', counter: 1 })).toBe(true);
      expect(ctx1.has({ replicaId: 'B', counter: 3 })).toBe(true);
    });
  });

  describe('Multi-Value Register (MVR)', () => {
    it('sets and retrieves single register values', () => {
      const store = new DeltaCRDTStore<string>('node-A');
      store.mvrPut('title', 'Design Spec v1');

      expect(store.mvrGet('title')).toEqual(['Design Spec v1']);
      expect(store.mvrGetResolved('title')).toBe('Design Spec v1');
    });

    it('preserves concurrent conflicting writes and converges on deterministic resolution', () => {
      const nodeA = new DeltaCRDTStore<string>('node-A');
      const nodeB = new DeltaCRDTStore<string>('node-B');

      // Concurrent writes without prior communication
      const deltaA = nodeA.mvrPut('status', 'draft');
      const deltaB = nodeB.mvrPut('status', 'review');

      // Cross-replicate deltas
      nodeA.merge(deltaB);
      nodeB.merge(deltaA);

      // Both replicas must contain both concurrent conflicting values
      expect(nodeA.mvrGet('status').sort()).toEqual(['draft', 'review']);
      expect(nodeB.mvrGet('status').sort()).toEqual(['draft', 'review']);

      // Deterministic tie-breaker must produce identical result on both nodes
      expect(nodeA.mvrGetResolved('status')).toBe(nodeB.mvrGetResolved('status'));

      // Subsequent update on nodeA overwrites both concurrent values
      const deltaA2 = nodeA.mvrPut('status', 'published');
      nodeB.merge(deltaA2);

      expect(nodeA.mvrGet('status')).toEqual(['published']);
      expect(nodeB.mvrGet('status')).toEqual(['published']);
    });
  });

  describe('Observed-Removed Set (OR-Set)', () => {
    it('adds and removes elements in a set', () => {
      const store = new DeltaCRDTStore<string>('node-1');
      store.orSetAdd('tags', 'security');
      store.orSetAdd('tags', 'audit');

      expect(store.orSetContains('tags', 'security')).toBe(true);
      expect(store.orSetContains('tags', 'audit')).toBe(true);
      expect(store.orSetContains('tags', 'deprecated')).toBe(false);

      store.orSetRemove('tags', 'audit');
      expect(store.orSetContains('tags', 'audit')).toBe(false);
      expect(store.orSetValues('tags')).toEqual(['security']);
    });

    it('exhibits Add-Wins semantics under concurrent add and remove', () => {
      const node1 = new DeltaCRDTStore<string>('node-1');
      const node2 = new DeltaCRDTStore<string>('node-2');

      // Initial state: element exists on node1 and is replicated to node2
      const initDelta = node1.orSetAdd('features', 'dark-mode');
      node2.merge(initDelta);

      expect(node2.orSetContains('features', 'dark-mode')).toBe(true);

      // Concurrent actions:
      // node1 removes 'dark-mode'
      const delDelta = node1.orSetRemove('features', 'dark-mode');
      // node2 concurrently re-adds 'dark-mode' (allocates a new unique dot)
      const addDelta = node2.orSetAdd('features', 'dark-mode');

      // Cross-replicate
      node1.merge(addDelta);
      node2.merge(delDelta);

      // Add-Wins: the newly allocated dot survives the deletion of old dots!
      expect(node1.orSetContains('features', 'dark-mode')).toBe(true);
      expect(node2.orSetContains('features', 'dark-mode')).toBe(true);
    });
  });

  describe('Last-Write-Wins Map (LWW)', () => {
    it('updates dictionary entries and respects physical timestamps', () => {
      const store = new DeltaCRDTStore<number>('node-X');
      store.lwwSet('cpu_limit', 4, 1000);
      expect(store.lwwGet('cpu_limit')).toBe(4);

      // Newer timestamp updates value
      store.lwwSet('cpu_limit', 8, 2000);
      expect(store.lwwGet('cpu_limit')).toBe(8);

      // Older timestamp does NOT overwrite
      store.lwwSet('cpu_limit', 2, 500);
      expect(store.lwwGet('cpu_limit')).toBe(8);

      // Delete with higher timestamp removes entry
      store.lwwDelete('cpu_limit', 3000);
      expect(store.lwwGet('cpu_limit')).toBeUndefined();
      expect(store.lwwKeys()).not.toContain('cpu_limit');
    });

    it('breaks ties deterministically by replicaId when timestamps are identical', () => {
      const nodeA = new DeltaCRDTStore<string>('alpha');
      const nodeB = new DeltaCRDTStore<string>('beta');

      const deltaA = nodeA.lwwSet('theme', 'blue', 5000);
      const deltaB = nodeB.lwwSet('theme', 'red', 5000);

      nodeA.merge(deltaB);
      nodeB.merge(deltaA);

      // 'beta' > 'alpha' lexicographically, so nodeB wins tie
      expect(nodeA.lwwGet('theme')).toBe('red');
      expect(nodeB.lwwGet('theme')).toBe('red');
    });
  });

  describe('Join-Semilattice Merge Laws', () => {
    it('demonstrates commutativity: A join B == B join A', () => {
      const makeA = () => {
        const s = new DeltaCRDTStore<string>('node-1');
        s.mvrPut('x', 'val1');
        s.orSetAdd('tags', 't1');
        s.lwwSet('config', 'cfg1', 100);
        return s;
      };

      const makeB = () => {
        const s = new DeltaCRDTStore<string>('node-2');
        s.mvrPut('x', 'val2');
        s.orSetAdd('tags', 't2');
        s.lwwSet('config', 'cfg2', 200);
        return s;
      };

      // Merge order 1: A merges B
      const s1 = makeA();
      const deltaB = makeB().flushPendingDeltas()!;
      s1.merge(deltaB);

      // Merge order 2: B merges A
      const s2 = makeB();
      const deltaA = makeA().flushPendingDeltas()!;
      s2.merge(deltaA);

      expect(s1.mvrGet('x').sort()).toEqual(s2.mvrGet('x').sort());
      expect(s1.orSetValues('tags').sort()).toEqual(s2.orSetValues('tags').sort());
      expect(s1.lwwGet('config')).toBe(s2.lwwGet('config'));
    });

    it('demonstrates idempotence: A join A == A', () => {
      const s = new DeltaCRDTStore<string>('node-1');
      const delta = s.mvrPut('key', 'first');
      s.orSetAdd('items', 'item-1');

      const snap1 = s.exportSnapshot();
      s.merge(delta); // re-apply own delta
      const snap2 = s.exportSnapshot();

      expect(snap1.mvrEntries).toEqual(snap2.mvrEntries);
      expect(s.orSetValues('items')).toEqual(['item-1']);
    });
  });

  describe('Snapshot Serialization & Integrity', () => {
    it('exports and imports store snapshots losslessly with cryptographic checksums', () => {
      const store = new DeltaCRDTStore<string>('main-node');
      store.mvrPut('k1', 'v1');
      store.orSetAdd('set1', 'elem1');
      store.lwwSet('setting', 'active', 500);

      const snapshot = store.exportSnapshot();
      expect(snapshot.checksum).toHaveLength(64);

      const restoredStore = new DeltaCRDTStore<string>('restored-node', snapshot);
      expect(restoredStore.mvrGet('k1')).toEqual(['v1']);
      expect(restoredStore.orSetContains('set1', 'elem1')).toBe(true);
      expect(restoredStore.lwwGet('setting')).toBe('active');
    });

    it('rejects tampered delta payload with invalid checksum', () => {
      const store = new DeltaCRDTStore<string>('node-1');
      const delta = store.mvrPut('k', 'v');
      delta.checksum = 'tampered-checksum-1234567890abcdef';

      const receiver = new DeltaCRDTStore<string>('node-2');
      expect(() => receiver.merge(delta)).toThrow('Corrupted delta payload checksum');
    });
  });
});
