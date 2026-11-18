import { describe, it, expect } from 'vitest';
import { ZeroKnowledgePrivateSetIntersectionProver } from '../../core/zkp/ZeroKnowledgePrivateSetIntersectionProver';

describe('ZeroKnowledgePrivateSetIntersectionProver', () => {
  const psi = new ZeroKnowledgePrivateSetIntersectionProver();

  it('computes verifiable mutual PSI with batched DLEQ proofs and audits the receipt', () => {
    const alice = psi.initParty('org-alice', 123456n);
    const bob = psi.initParty('org-bob', 654321n);

    const setA = ['alice@ws.io', 'bob@ws.io', 'carol@ws.io', 'dave@ws.io', 'eve@ws.io'];
    const setB = ['frank@ws.io', 'bob@ws.io', 'dave@ws.io', 'grace@ws.io'];

    const receipt = psi.executeMutualPSI('psi-session-2026', alice, setA, bob, setB);
    expect(receipt.intersectionElements).toEqual(['bob@ws.io', 'dave@ws.io']);
    expect(receipt.intersectionCardinality).toBe(2);
    expect(psi.auditPSIReceipt(receipt).valid).toBe(true);

    // Tampered cardinality or tampered DLEQ proof must fail audit
    expect(psi.auditPSIReceipt({ ...receipt, intersectionCardinality: 3 }).valid).toBe(false);
    expect(
      psi.auditPSIReceipt({
        ...receipt,
        proofBDouble: { ...receipt.proofBDouble, responseS: receipt.proofBDouble.responseS + 1n },
      }).valid
    ).toBe(false);
  });

  it('handles disjoint sets and round-trips JSON proof serialization', () => {
    const pA = psi.initParty('team-a');
    const pB = psi.initParty('team-b');

    const receipt = psi.executeMutualPSI('psi-disjoint', pA, ['x', 'y'], pB, ['z', 'w']);
    expect(receipt.intersectionElements).toEqual([]);
    expect(receipt.intersectionCardinality).toBe(0);
    expect(psi.auditPSIReceipt(receipt).valid).toBe(true);

    const json = psi.serializeProof(receipt.proofAInitial);
    const restored = psi.deserializeProof(json);
    expect(restored).toEqual(receipt.proofAInitial);
    expect(psi.verifyBlindingProof(restored)).toBe(true);
  });
});
