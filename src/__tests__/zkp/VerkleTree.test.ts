import { describe, it, expect, beforeEach } from 'vitest';
import { VerkleTree } from '../../core/zkp/VerkleTree';

describe('VerkleTree - Vector Polynomial Commitments & Multi-Opening Proofs', () => {
  let tree: VerkleTree;

  beforeEach(() => {
    tree = new VerkleTree(16, 3); // Width 16, Depth 3
  });

  describe('Vector Polynomial Commitments', () => {
    it('computes deterministic vector polynomial commitments', () => {
      const vec1 = [10n, 20n, 30n, 40n];
      const vec2 = [10n, 20n, 30n, 40n];
      const vec3 = [10n, 20n, 30n, 50n];

      const c1 = tree.commitVector(vec1);
      const c2 = tree.commitVector(vec2);
      const c3 = tree.commitVector(vec3);

      expect(c1).toBe(c2);
      expect(c1).not.toBe(c3);
    });
  });

  describe('Tree State & Key Lifecycle', () => {
    it('inserts key-value pairs and deterministically updates root commitment', () => {
      const root0 = tree.root;
      const root1 = tree.insert('desk_tokyo_01', 'STATUS_LEASED_BOB');

      expect(root1).not.toBe(root0);
      expect(tree.size).toBe(1);
      expect(tree.get('desk_tokyo_01')).toBe('STATUS_LEASED_BOB');

      // Update existing key
      const root2 = tree.insert('desk_tokyo_01', 'STATUS_AVAILABLE');
      expect(root2).not.toBe(root1);
      expect(tree.get('desk_tokyo_01')).toBe('STATUS_AVAILABLE');
    });

    it('deletes keys and updates root commitment', () => {
      tree.insert('pod_shibuya_05', 'RESERVED');
      expect(tree.size).toBe(1);

      const deleted = tree.delete('pod_shibuya_05');
      expect(deleted).toBe(true);
      expect(tree.size).toBe(0);
      expect(tree.get('pod_shibuya_05')).toBeUndefined();
    });
  });

  describe('Verkle Evaluation Opening Proofs', () => {
    it('generates and verifies cryptographic quotient evaluation proof for key', () => {
      tree.insert('desk_kyoto_401', 'OCCUPIED_BY_SATOSHI');
      const proof = tree.prove('desk_kyoto_401');

      expect(proof.isMembership).toBe(true);
      expect(proof.value).toBe('OCCUPIED_BY_SATOSHI');
      expect(proof.path.length).toBe(3);
      expect(proof.rootCommitment).toBe(tree.root);

      // Verify valid proof
      const isValid = VerkleTree.verifyProof(proof);
      expect(isValid).toBe(true);

      // Tampered root verification must fail
      const badProof = {
        ...proof,
        rootCommitment: '0000000000000000000000000000000000000000000000000000000000000000',
      };
      expect(VerkleTree.verifyProof(badProof)).toBe(false);
    });
  });
});
