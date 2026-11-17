import { describe, it, expect } from 'vitest';
import {
  DeltaCRDTLog,
  CRDTOpType,
  GENESIS_OP_HASH,
} from '../../core/crdt/DeltaCRDTLog';

describe('DeltaCRDTLog (Verifiable Delta CRDT)', () => {
  describe('Local Mutations & Merkle Hash Chain', () => {
    it('creates authenticated causal dots and links parent hashes', () => {
      const crdt = new DeltaCRDTLog('node_A');
      const op1 = crdt.set('title', 'WorkSphere Architecture');

      expect(op1.dot.actor).toBe('node_A');
      expect(op1.dot.counter).toBe(1);
      expect(op1.parentHash).toBe(GENESIS_OP_HASH);
      expect(op1.opHash.length).toBe(64);

      const op2 = crdt.set('version', '2.0.0');
      expect(op2.dot.counter).toBe(2);
      expect(op2.parentHash).toBe(op1.opHash); // Merkle chain link!
      expect(crdt.get('title')).toBe('WorkSphere Architecture');
      expect(crdt.get('version')).toBe('2.0.0');
    });

    it('handles delete tombstones with incremented causal dots', () => {
      const crdt = new DeltaCRDTLog('node_A');
      crdt.set('temp', 123);
      const delOp = crdt.delete('temp');

      expect(delOp).not.toBeNull();
      expect(delOp!.opType).toBe(CRDTOpType.DELETE);
      expect(crdt.get('temp')).toBeUndefined();
    });
  });

  describe('Delta Sync & Strong Eventual Consistency', () => {
    it('synchronizes bidirectional deltas and converges to identical state digest', () => {
      const peerA = new DeltaCRDTLog('peer_A');
      const peerB = new DeltaCRDTLog('peer_B');

      // Peer A mutations
      peerA.set('key1', 'alpha');
      peerA.set('key2', 'beta');

      // Peer B mutations
      peerB.set('key3', 'gamma');
      peerB.set('key4', 'delta');

      // Generate deltas
      const deltaAtoB = peerA.generateDelta(peerB.getVersionVector());
      const deltaBtoA = peerB.generateDelta(peerA.getVersionVector());

      // Merge
      peerB.mergeDelta(deltaAtoB);
      peerA.mergeDelta(deltaBtoA);

      // Verify convergence
      expect(peerA.get('key1')).toBe('alpha');
      expect(peerA.get('key3')).toBe('gamma');
      expect(peerB.get('key1')).toBe('alpha');
      expect(peerB.get('key3')).toBe('gamma');

      expect(peerA.computeStateHash()).toBe(peerB.computeStateHash());
    });

    it('rejects tampered operation hash in incoming delta', () => {
      const peerA = new DeltaCRDTLog('peer_A');
      const peerB = new DeltaCRDTLog('peer_B');

      peerA.set('security', 'strict');
      const delta = peerA.generateDelta();

      // Tamper operation hash
      const tamperedOps = [
        {
          ...delta.operations[0],
          opHash: '0000000000000000000000000000000000000000000000000000000000000000',
        },
      ];

      expect(() => {
        peerB.mergeDelta({ ...delta, operations: tamperedOps });
      }).toThrow('Cryptographic hash mismatch');
    });
  });

  describe('Log Pruning & Stable Horizon', () => {
    it('prunes acknowledged log entries beyond stable vector horizon', () => {
      const crdt = new DeltaCRDTLog('node_A');
      crdt.set('k1', 1);
      crdt.set('k2', 2);
      crdt.set('k3', 3);

      const stableHorizon = { node_A: 2 };
      const pruned = crdt.pruneLog(stableHorizon);

      expect(pruned).toBe(2);
      // State remains preserved
      expect(crdt.get('k1')).toBe(1);
      expect(crdt.get('k2')).toBe(2);
      expect(crdt.get('k3')).toBe(3);
    });
  });
});
