import { describe, it, expect } from 'vitest';
import {
  CompressedCanopyTree,
  hashNodes,
  computeZeroHashes,
  EMPTY_NODE,
  type CompressedAssetLeaf,
} from '../../core/solana/CompressedCanopyTree';

describe('CompressedCanopyTree (SPL Account Compression)', () => {
  describe('Zero Hashes & Initialization', () => {
    it('computes deterministic zero-node ladder', () => {
      const zeros = computeZeroHashes(4);
      expect(zeros.length).toBe(5);
      expect(zeros[0]).toBe(EMPTY_NODE);
      expect(zeros[1]).toBe(hashNodes(EMPTY_NODE, EMPTY_NODE));
    });

    it('initializes tree with correct zero root', () => {
      const tree = new CompressedCanopyTree(6, 16, 2);
      const expectedZeroRoot = computeZeroHashes(6)[6];
      expect(tree.getRoot()).toBe(expectedZeroRoot);
      expect(tree.isValidRoot(expectedZeroRoot)).toBe(true);
    });

    it('validates depth bounds in constructor', () => {
      expect(() => new CompressedCanopyTree(4, 16, 5)).toThrow('canopyDepth (5) cannot exceed maxDepth (4)');
      expect(() => new CompressedCanopyTree(0, 16, 0)).toThrow('maxDepth must be between 1 and 30');
    });
  });

  describe('Append & Truncated Merkle Proofs', () => {
    const depth = 6;
    const canopy = 2;
    const tree = new CompressedCanopyTree(depth, 16, canopy);

    it('appends leaves and updates tree state', () => {
      const leaf1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const leaf2 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

      const res1 = tree.append(leaf1);
      expect(res1.index).toBe(0);
      expect(tree.getRoot()).toBe(res1.newRoot);

      const res2 = tree.append(leaf2);
      expect(res2.index).toBe(1);
      expect(tree.getCount()).toBe(2);
    });

    it('generates truncated proofs of exact length (maxDepth - canopyDepth)', () => {
      const proofObj = tree.getTruncatedProof(0);
      const expectedTruncatedLen = depth - canopy; // 6 - 2 = 4
      expect(proofObj.truncatedProof.length).toBe(expectedTruncatedLen);
      expect(proofObj.canopyDepth).toBe(canopy);
      expect(proofObj.fullProofLength).toBe(depth);

      const leaf1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const isValid = tree.verifyTruncatedProof(0, leaf1, proofObj.truncatedProof);
      expect(isValid).toBe(true);
    });

    it('rejects tampered leaf verification', () => {
      const proofObj = tree.getTruncatedProof(0);
      const tamperedLeaf = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
      const isValid = tree.verifyTruncatedProof(0, tamperedLeaf, proofObj.truncatedProof);
      expect(isValid).toBe(false);
    });
  });

  describe('Leaf Updates & Concurrent Changelog', () => {
    const tree = new CompressedCanopyTree(4, 8, 1);
    const leafA = '1111111111111111111111111111111111111111111111111111111111111111';
    const leafB = '2222222222222222222222222222222222222222222222222222222222222222';
    const leafUpdated = '9999999999999999999999999999999999999999999999999999999999999999';

    it('updates leaf using valid truncated proof and records changelog', () => {
      tree.append(leafA);
      tree.append(leafB);

      const proof = tree.getTruncatedProof(0);
      const newRoot = tree.updateLeaf(0, leafA, leafUpdated, proof.truncatedProof);
      expect(tree.getRoot()).toBe(newRoot);

      // Verify updated leaf
      const newProof = tree.getTruncatedProof(0);
      expect(tree.verifyTruncatedProof(0, leafUpdated, newProof.truncatedProof)).toBe(true);

      // Changelog check
      const changelog = tree.getChangelog();
      expect(changelog.length).toBeGreaterThan(0);
      const lastEntry = changelog[changelog.length - 1];
      expect(lastEntry.leafIndex).toBe(0);
      expect(lastEntry.previousLeaf).toBe(leafA);
      expect(lastEntry.newLeaf).toBe(leafUpdated);
      expect(lastEntry.root).toBe(newRoot);
    });

    it('hashes compressed asset micro-escrow leaf data correctly', () => {
      const asset: CompressedAssetLeaf = {
        assetId: 'DeskPass_Solana_42',
        owner: 'SolanaWalletOwner_Pubkey_123',
        delegate: 'WorkSphereEscrow_Program_456',
        amount: 5000000n,
        nonce: 1n,
        dataHash: 'cafebeefcafebeefcafebeefcafebeefcafebeefcafebeefcafebeefcafebeef',
      };

      const hash1 = CompressedCanopyTree.hashLeafData(asset);
      const hash2 = CompressedCanopyTree.hashLeafData(asset);
      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64);
    });
  });
});
