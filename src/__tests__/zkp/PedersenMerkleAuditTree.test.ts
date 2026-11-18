import { describe, it, expect } from 'vitest';
import { PedersenMerkleAuditTree } from '../../core/zkp/PedersenMerkleAuditTree';

describe('PedersenMerkleAuditTree', () => {
  it('builds a homomorphic Pedersen-Merkle tree and verifies individual inclusion proofs', () => {
    const tree = new PedersenMerkleAuditTree();
    const entries = [
      { accountId: 'team-alpha', amount: 1200n },
      { accountId: 'team-beta', amount: 3450n },
      { accountId: 'team-gamma', amount: 800n },
      { accountId: 'team-delta', amount: 2150n },
      { accountId: 'team-epsilon', amount: 400n },
    ];

    const summary = tree.buildTree(entries);
    expect(summary.leafCount).toBe(5);
    expect(summary.paddedSize).toBe(8);

    for (const entry of entries) {
      const proof = tree.generateInclusionProof(entry.accountId);
      expect(proof.amount).toBe(entry.amount);
      const check = tree.verifyInclusionProof(proof, summary.rootHash, summary.rootCommitment);
      expect(check.valid).toBe(true);
    }

    const tampered = { ...tree.generateInclusionProof('team-alpha'), amount: 1201n };
    expect(tree.verifyInclusionProof(tampered, summary.rootHash, summary.rootCommitment).valid).toBe(false);
  });

  it('proves root total solvency against declared reserves without exposing leaf amounts', () => {
    const tree = new PedersenMerkleAuditTree();
    tree.buildTree([
      { accountId: 'dept-1', amount: 5000n },
      { accountId: 'dept-2', amount: 7500n },
      { accountId: 'dept-3', amount: 2500n },
    ]);

    const solvency = tree.createRootSolvencyProof('q4-audit');
    expect(solvency.totalAmount).toBe(15000n);

    const solventCheck = tree.verifyRootSolvency(solvency, 18000n, 'q4-audit');
    expect(solventCheck.valid).toBe(true);
    expect(solventCheck.solvent).toBe(true);
    expect(solventCheck.surplus).toBe(3000n);

    const insolventCheck = tree.verifyRootSolvency(solvency, 14000n, 'q4-audit');
    expect(insolventCheck.valid).toBe(true);
    expect(insolventCheck.solvent).toBe(false);
    expect(insolventCheck.surplus).toBe(-1000n);

    const forgedSolvency = { ...solvency, totalAmount: 10000n };
    expect(tree.verifyRootSolvency(forgedSolvency, 18000n, 'q4-audit').valid).toBe(false);
  });

  it('batch-verifies inclusion proofs, rejects negative/duplicate inputs, and serializes proofs', () => {
    const tree = new PedersenMerkleAuditTree();
    expect(() => tree.buildTree([{ accountId: 'neg', amount: -5n }])).toThrow();
    expect(() =>
      tree.buildTree([
        { accountId: 'dup', amount: 10n },
        { accountId: 'dup', amount: 20n },
      ])
    ).toThrow();

    const summary = tree.buildTree([
      { accountId: 'acc-1', amount: 300n },
      { accountId: 'acc-2', amount: 700n },
      { accountId: 'acc-3', amount: 1000n },
    ]);

    const p1 = tree.generateInclusionProof('acc-1');
    const p3 = tree.generateInclusionProof('acc-3');
    const batch = tree.batchVerifyInclusionProofs([p1, p3], summary.rootHash, summary.rootCommitment);
    expect(batch.allValid).toBe(true);
    expect(batch.verifiedAccounts).toEqual(['acc-1', 'acc-3']);
    expect(batch.provenSubtotal).toBe(1300n);

    const json = tree.serializeInclusionProof(p1);
    const restored = tree.deserializeInclusionProof(json);
    expect(restored).toEqual(p1);
    expect(tree.verifyInclusionProof(restored, summary.rootHash, summary.rootCommitment).valid).toBe(true);
  });
});
