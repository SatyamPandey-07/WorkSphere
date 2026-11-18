import { describe, it, expect, beforeEach } from 'vitest';
import { SparseMerkleTree } from '../../core/zkp/SparseMerkleTree';

describe('SparseMerkleTree - Verifiable Inclusion & Non-Membership Tree', () => {
  let smt: SparseMerkleTree;

  beforeEach(() => {
    smt = new SparseMerkleTree(16); // 16-bit depth for agile unit testing
  });

  describe('Tree Initialization & Default Empty State', () => {
    it('initializes tree with deterministic default empty root hash', () => {
      expect(smt.depth).toBe(16);
      expect(smt.size).toBe(0);
      expect(smt.root).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('Key Insertion, Retrieval & Root Transition', () => {
    it('inserts key-value pairs and deterministically updates state root', () => {
      const root0 = smt.root;
      const root1 = smt.insert('desk_401', 'STATUS_OCCUPIED_ALICE');

      expect(root1).not.toBe(root0);
      expect(smt.size).toBe(1);
      expect(smt.get('desk_401')).toBe('STATUS_OCCUPIED_ALICE');

      // Update existing key
      const root2 = smt.insert('desk_401', 'STATUS_AVAILABLE');
      expect(root2).not.toBe(root1);
      expect(smt.get('desk_401')).toBe('STATUS_AVAILABLE');
    });

    it('deletes keys and recomputes root', () => {
      smt.insert('temp_lock_01', 'LOCKED');
      expect(smt.size).toBe(1);

      const deleted = smt.delete('temp_lock_01');
      expect(deleted).toBe(true);
      expect(smt.size).toBe(0);
      expect(smt.get('temp_lock_01')).toBeUndefined();
    });
  });

  describe('Cryptographic Membership & Non-Membership Proofs', () => {
    it('generates membership proof for populated key', () => {
      smt.insert('desk_vip_1', 'VIP_RESERVED');
      const proof = smt.prove('desk_vip_1');

      expect(proof.isMembership).toBe(true);
      expect(proof.value).toBe('VIP_RESERVED');
      expect(proof.siblings.length).toBe(16);
      expect(proof.root).toBe(smt.root);
    });

    it('generates non-membership proof for missing key', () => {
      smt.insert('desk_vip_1', 'VIP_RESERVED');
      const proof = smt.prove('unregistered_desk_999');

      expect(proof.isMembership).toBe(false);
      expect(proof.value).toBeUndefined();
      expect(proof.siblings.length).toBe(16);
    });
  });

  describe('Batch Operations', () => {
    it('batch inserts multiple entries atomically', () => {
      const entries = [
        { key: 'seat_101', value: 'OCCUPIED' },
        { key: 'seat_102', value: 'AVAILABLE' },
        { key: 'seat_103', value: 'HELD' },
      ];

      const newRoot = smt.batchInsert(entries);
      expect(smt.size).toBe(3);
      expect(smt.get('seat_101')).toBe('OCCUPIED');
      expect(smt.get('seat_102')).toBe('AVAILABLE');
      expect(smt.get('seat_103')).toBe('HELD');
      expect(newRoot).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
