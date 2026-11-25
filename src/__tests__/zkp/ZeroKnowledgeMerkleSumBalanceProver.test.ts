import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeMerkleSumBalanceProver } from '../../core/zkp/ZeroKnowledgeMerkleSumBalanceProver';

describe('ZeroKnowledgeMerkleSumBalanceProver', () => {
  it('builds a Merkle-Sum liability tree, proves account inclusion, and blocks negative-sum tampering', () => {
    const prover = new ZeroKnowledgeMerkleSumBalanceProver();
    const entries = [
      { accountId: 'acct-1', balance: 1500n },
      { accountId: 'acct-2', balance: 4200n },
      { accountId: 'acct-3', balance: 800n },
      { accountId: 'acct-4', balance: 3500n },
      { accountId: 'acct-5', balance: 2000n },
    ];
    const summary = prover.buildTree('epoch-2026-Q4', entries);
    expect(summary.totalLiabilities).toBe(12000n);
    expect(summary.totalAccounts).toBe(5);

    const proof = prover.generateInclusionProof('acct-2');
    expect(prover.verifyInclusionProof(proof, summary.rootHash, summary.totalLiabilities).valid).toBe(true);

    // Tampered balance or negative sibling sum attack must be rejected
    expect(
      prover.verifyInclusionProof({ ...proof, balance: 4201n }, summary.rootHash, summary.totalLiabilities).valid
    ).toBe(false);
    const negSib = {
      ...proof,
      path: [{ ...proof.path[0], siblingSum: -100n }, ...proof.path.slice(1)],
    };
    expect(prover.verifyInclusionProof(negSib, summary.rootHash, summary.totalLiabilities).valid).toBe(false);
  });

  it('issues solvency certificates, batch-audits accounts, and round-trips JSON serialization', () => {
    const prover = new ZeroKnowledgeMerkleSumBalanceProver();
    prover.buildTree('epoch-cert', [
      { accountId: 'u1', balance: 600n },
      { accountId: 'u2', balance: 400n },
      { accountId: 'u3', balance: 1000n },
    ]);

    const cert = prover.issueSolvencyCertificate(2500n);
    expect(cert.solvent).toBe(true);
    expect(cert.surplus).toBe(500n);

    const p1 = prover.generateInclusionProof('u1');
    const p3 = prover.generateInclusionProof('u3');
    const batch = prover.batchVerifyAgainstCertificate([p1, p3], cert);
    expect(batch.allValid).toBe(true);
    expect(batch.auditedBalanceTotal).toBe(1600n);

    const json = prover.serializeInclusionProof(p1);
    const restored = prover.deserializeInclusionProof(json);
    expect(restored).toEqual(p1);
    expect(prover.verifyInclusionProof(restored, cert.rootHash, cert.totalLiabilities).valid).toBe(true);
  });
});
