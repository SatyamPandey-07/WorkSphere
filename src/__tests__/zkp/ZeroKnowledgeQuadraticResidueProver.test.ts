import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeQuadraticResidueProver } from '../../core/zkp/ZeroKnowledgeQuadraticResidueProver';

describe('ZeroKnowledgeQuadraticResidueProver', () => {
  const ffs = new ZeroKnowledgeQuadraticResidueProver();

  it('proves and verifies non-interactive Feige-Fiat-Shamir quadratic-residue identities', () => {
    const idAlice = ffs.generateIdentity('alice@worksphere.io', 8);
    const proof = ffs.proveIdentity('ffs-login-1', idAlice, 'session-challenge-2026', 16);

    expect(proof.soundnessBits).toBe(128);
    expect(ffs.verifyIdentityProof(proof, idAlice.publicResidues, 'session-challenge-2026').valid).toBe(true);

    // Wrong context message or tampered round response must fail
    expect(ffs.verifyIdentityProof(proof, idAlice.publicResidues, 'wrong-challenge').valid).toBe(false);
    const tampered = {
      ...proof,
      responsesY: [proof.responsesY[0] + 1n, ...proof.responsesY.slice(1)],
    };
    const res = ffs.verifyIdentityProof(tampered, idAlice.publicResidues, 'session-challenge-2026');
    expect(res.valid).toBe(false);
    expect(res.failedRound).toBe(0);
  });

  it('verifies multi-identity authentication quorums and round-trips JSON serialization', () => {
    const id1 = ffs.generateIdentity('admin-1', 6);
    const id2 = ffs.generateIdentity('admin-2', 6);
    const id3 = ffs.generateIdentity('admin-3', 6);

    const registry = new Map<string, readonly bigint[]>([
      [id1.identityId, id1.publicResidues],
      [id2.identityId, id2.publicResidues],
      [id3.identityId, id3.publicResidues],
    ]);

    const p1 = ffs.proveIdentity('q-1', id1, 'deploy-prod', 10);
    const p2 = ffs.proveIdentity('q-2', id2, 'deploy-prod', 10);
    const p3Bad = { ...ffs.proveIdentity('q-3', id3, 'deploy-prod', 10), responsesY: new Array(10).fill(1n) };

    const quorum = ffs.verifyIdentityQuorum([p1, p2, p3Bad], registry, 'deploy-prod', 2);
    expect(quorum.quorumMet).toBe(true);
    expect(quorum.verifiedIdentities).toEqual(['admin-1', 'admin-2']);
    expect(quorum.rejectedIdentities).toEqual(['admin-3']);

    const json = ffs.serializeProof(p1);
    const restored = ffs.deserializeProof(json);
    expect(restored).toEqual(p1);
    expect(ffs.verifyIdentityProof(restored, id1.publicResidues, 'deploy-prod').valid).toBe(true);
  });
});
