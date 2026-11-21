import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeSetCardinalityProver, SAFE_PRIME_P, SUBGROUP_Q } from '../../core/zkp/ZeroKnowledgeSetCardinalityProver';

describe('ZeroKnowledgeSetCardinalityProver', () => {
  const prover = new ZeroKnowledgeSetCardinalityProver();

  it('computes exact intersection and union cardinalities privately with DLEQ proofs of honest blinding', () => {
    const keysA = prover.createPartyKeys('org-alpha');
    const keysB = prover.createPartyKeys('org-beta');

    const setA = ['alice@ex.com', 'bob@ex.com', 'carol@ex.com', 'dave@ex.com', 'eve@ex.com', 'alice@ex.com'];
    const setB = ['carol@ex.com', 'eve@ex.com', 'frank@ex.com', 'grace@ex.com'];

    const cert = prover.runVerifiableCardinalityProtocol('psi-ca-2026', keysA, setA, keysB, setB);
    expect(cert.proofsValid).toBe(true);
    expect(cert.sizeA).toBe(5);
    expect(cert.sizeB).toBe(4);
    expect(cert.intersectionCardinality).toBe(2);
    expect(cert.unionCardinality).toBe(7);
    expect(cert.jaccardNumerator).toBe(2);
    expect(cert.jaccardDenominator).toBe(7);

    const parsed = JSON.parse(prover.serializeCertificate(cert)) as { intersectionCardinality: number };
    expect(parsed.intersectionCardinality).toBe(2);
  });

  it('handles disjoint sets (|A cap B| = 0), identical sets (Jaccard = 1), and empty set boundaries', () => {
    const kA = prover.createPartyKeys('party-a', 111111n);
    const kB = prover.createPartyKeys('party-b', 222222n);

    const disjoint = prover.runVerifiableCardinalityProtocol('disjoint-1', kA, ['a', 'b', 'c'], kB, ['x', 'y']);
    expect(disjoint.proofsValid).toBe(true);
    expect(disjoint.intersectionCardinality).toBe(0);
    expect(disjoint.unionCardinality).toBe(5);

    const identical = prover.runVerifiableCardinalityProtocol('ident-1', kA, ['k1', 'k2', 'k3'], kB, ['k3', 'k1', 'k2']);
    expect(identical.proofsValid).toBe(true);
    expect(identical.intersectionCardinality).toBe(3);
    expect(identical.unionCardinality).toBe(3);
    expect(identical.jaccardNumerator).toBe(3);
    expect(identical.jaccardDenominator).toBe(3);

    const withEmpty = prover.runVerifiableCardinalityProtocol('empty-b', kA, ['only-a1', 'only-a2'], kB, []);
    expect(withEmpty.proofsValid).toBe(true);
    expect(withEmpty.sizeA).toBe(2);
    expect(withEmpty.sizeB).toBe(0);
    expect(withEmpty.intersectionCardinality).toBe(0);
    expect(withEmpty.unionCardinality).toBe(2);
  });

  it('rejects zero blinding keys and every tampered field in Chaum-Pedersen batch DLEQ proofs', () => {
    expect(() => prover.createPartyKeys('bad-zero', 0n)).toThrow();

    const kA = prover.createPartyKeys('org-1');
    const kB = prover.createPartyKeys('org-2');
    const msgA = prover.blindRawSet(kA, ['e1', 'e2', 'e3', 'e4'], 'round-1');
    const doubleAB = prover.doubleBlindReceived(kB, msgA.blindedElements, 'round-2');

    expect(prover.verifyProductDLEQ(doubleAB.dleqProof, msgA.blindedElements, doubleAB.blindedElements)).toBe(true);

    // Corrupted output element
    const corruptedOut = doubleAB.blindedElements.map((v, i) => (i === 0 ? (v * 4n) % SAFE_PRIME_P : v));
    expect(prover.verifyProductDLEQ(doubleAB.dleqProof, msgA.blindedElements, corruptedOut)).toBe(false);

    // Corrupted input element or wrong count
    const corruptedIn = msgA.blindedElements.map((v, i) => (i === 1 ? (v * 4n) % SAFE_PRIME_P : v));
    expect(prover.verifyProductDLEQ(doubleAB.dleqProof, corruptedIn, doubleAB.blindedElements)).toBe(false);
    expect(prover.verifyProductDLEQ(doubleAB.dleqProof, msgA.blindedElements.slice(1), doubleAB.blindedElements)).toBe(false);

    // Tampered proof fields
    const p = doubleAB.dleqProof;
    expect(prover.verifyProductDLEQ({ ...p, challenge: (p.challenge + 1n) % SUBGROUP_Q }, msgA.blindedElements, doubleAB.blindedElements)).toBe(false);
    expect(prover.verifyProductDLEQ({ ...p, responseK: (p.responseK + 1n) % SUBGROUP_Q }, msgA.blindedElements, doubleAB.blindedElements)).toBe(false);
    expect(prover.verifyProductDLEQ({ ...p, announceA: (p.announceA * 4n) % SAFE_PRIME_P }, msgA.blindedElements, doubleAB.blindedElements)).toBe(false);
    expect(prover.verifyProductDLEQ({ ...p, announceB: (p.announceB * 4n) % SAFE_PRIME_P }, msgA.blindedElements, doubleAB.blindedElements)).toBe(false);
    expect(prover.verifyProductDLEQ({ ...p, publicY: kA.publicY }, msgA.blindedElements, doubleAB.blindedElements)).toBe(false);
    expect(prover.verifyProductDLEQ({ ...p, context: 'wrong-ctx' }, msgA.blindedElements, doubleAB.blindedElements)).toBe(false);
  });

  it('produces symmetric intersection counts regardless of party ordering', () => {
    const k1 = prover.createPartyKeys('p1');
    const k2 = prover.createPartyKeys('p2');
    const s1 = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'];
    const s2 = ['u2', 'u4', 'u6', 'u8', 'u10'];

    const fwd = prover.runVerifiableCardinalityProtocol('sym-1', k1, s1, k2, s2);
    const rev = prover.runVerifiableCardinalityProtocol('sym-2', k2, s2, k1, s1);

    expect(fwd.proofsValid).toBe(true);
    expect(rev.proofsValid).toBe(true);
    expect(fwd.intersectionCardinality).toBe(3);
    expect(rev.intersectionCardinality).toBe(3);
    expect(fwd.unionCardinality).toBe(8);
    expect(rev.unionCardinality).toBe(8);
  });
});
