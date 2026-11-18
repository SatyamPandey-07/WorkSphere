import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeVectorEqualityProver, SAFE_PRIME_P, SUBGROUP_Q } from '../../core/zkp/ZeroKnowledgeVectorEqualityProver';

describe('ZeroKnowledgeVectorEqualityProver', () => {
  const prover = new ZeroKnowledgeVectorEqualityProver();

  it('proves exact committed vector equality, scalar scaling, and affine shifts in one constant-size proof', () => {
    const vA = prover.commitVector('vec-a', [10n, 20n, 30n, 40n, 50n]);
    const vEqual = prover.commitVector('vec-eq', [10n, 20n, 30n, 40n, 50n]);

    const eqProof = prover.proveVectorRelation(vA, vEqual, 1n, undefined, 'reblind-check');
    expect(prover.verifyVectorRelation(eqProof)).toBe(true);
    // Commitments are freshly blinded and completely distinct
    expect(vA.commitments[0]).not.toBe(vEqual.commitments[0]);

    // Affine transformation: vB = 3 * vEqual + [5, -2, 0, 11, 7]
    const shifts = [5n, -2n, 0n, 11n, 7n];
    const vB = prover.deriveShiftedVector(vEqual, 3n, shifts, 'vec-b');
    const affineProof = prover.proveVectorRelation(vEqual, vB, 3n, shifts, 'scale-shift');
    expect(prover.verifyVectorRelation(affineProof)).toBe(true);

    // Equivalence chain links vA -> vEqual -> vB
    expect(prover.verifyEquivalenceChain([eqProof, affineProof])).toEqual({ allValid: true, brokenAt: -1 });

    const json = JSON.parse(prover.serializeProof(affineProof)) as { dimension: number; scaleFactor: string };
    expect(json.dimension).toBe(5);
    expect(json.scaleFactor).toBe('3');
  });

  it('handles zero-scale constant vectors, single-element vectors, and large 16-dim batches', () => {
    const v16 = prover.commitVector('big-a', Array.from({ length: 16 }, (_, i) => BigInt(i * 17 + 3)));
    const s16 = Array.from({ length: 16 }, (_, i) => BigInt(i + 1));
    const v16Shifted = prover.deriveShiftedVector(v16, 2n, s16, 'big-b');
    const p16 = prover.proveVectorRelation(v16, v16Shifted, 2n, s16, 'dim-16');
    expect(prover.verifyVectorRelation(p16)).toBe(true);

    const soloA = prover.commitVector('sA', [99n], [111n]);
    const soloB = prover.commitVector('sB', [99n], [222n]);
    expect(prover.verifyVectorRelation(prover.proveVectorRelation(soloA, soloB, 1n, [0n], 'solo'))).toBe(true);

    // Zero scale factor: b = 0 * a + shift = shift
    const zeroScaleB = prover.deriveShiftedVector(soloA, 0n, [77n], 'const-77');
    expect(prover.verifyVectorRelation(prover.proveVectorRelation(soloA, zeroScaleB, 0n, [77n], 'zero-scale'))).toBe(true);
  });

  it('rejects violated coordinates, broken chains, and tampered proof fields', () => {
    expect(() => prover.commitVector('empty', [])).toThrow();
    expect(() => prover.commitVector('bad-blind', [1n, 2n], [1n])).toThrow();

    const a = prover.commitVector('a', [1n, 2n, 3n]);
    const bBad = prover.commitVector('b-bad', [1n, 2n, 4n]);
    expect(() => prover.proveVectorRelation(a, bBad)).toThrow();
    expect(() => prover.proveVectorRelation(a, prover.commitVector('short', [1n]))).toThrow();

    const bOk = prover.commitVector('b-ok', [1n, 2n, 3n]);
    const proof = prover.proveVectorRelation(a, bOk, 1n, [0n, 0n, 0n], 'strict');
    expect(prover.verifyVectorRelation(proof)).toBe(true);

    expect(prover.verifyVectorRelation({ ...proof, dimension: 0 })).toBe(false);
    expect(prover.verifyVectorRelation({ ...proof, scaleFactor: 2n })).toBe(false);
    expect(prover.verifyVectorRelation({ ...proof, shiftVector: [1n, 0n, 0n] })).toBe(false);
    expect(prover.verifyVectorRelation({ ...proof, foldingGamma: (proof.foldingGamma + 1n) % SUBGROUP_Q })).toBe(false);
    expect(prover.verifyVectorRelation({ ...proof, challenge: (proof.challenge + 1n) % SUBGROUP_Q })).toBe(false);
    expect(prover.verifyVectorRelation({ ...proof, responseBlinding: (proof.responseBlinding + 1n) % SUBGROUP_Q })).toBe(false);
    expect(prover.verifyVectorRelation({ ...proof, announcementR: (proof.announcementR * 4n) % SAFE_PRIME_P })).toBe(false);
    expect(prover.verifyVectorRelation({ ...proof, context: 'wrong' })).toBe(false);

    // Broken equivalence chain detected
    const c = prover.commitVector('c', [5n, 6n, 7n]);
    const d = prover.commitVector('d', [5n, 6n, 7n]);
    const p2 = prover.proveVectorRelation(c, d, 1n, undefined, 'unlinked');
    expect(prover.verifyEquivalenceChain([proof, p2])).toEqual({ allValid: false, brokenAt: 1 });
  });

  it('proves multi-step equivalence chains across 4 sequential re-blindings and negative modular scales', () => {
    const base = prover.commitVector('v0', [12n, 34n, 56n, 78n]);
    const v1 = prover.deriveShiftedVector(base, 1n, [0n, 0n, 0n, 0n], 'v1');
    const v2 = prover.deriveShiftedVector(v1, -1n, [100n, 100n, 100n, 100n], 'v2'); // 100 - v1
    const v3 = prover.deriveShiftedVector(v2, 5n, [-50n, 0n, 50n, 100n], 'v3');

    const p01 = prover.proveVectorRelation(base, v1, 1n, [0n, 0n, 0n, 0n], 'hop-1');
    const p12 = prover.proveVectorRelation(v1, v2, -1n, [100n, 100n, 100n, 100n], 'hop-2');
    const p23 = prover.proveVectorRelation(v2, v3, 5n, [-50n, 0n, 50n, 100n], 'hop-3');

    expect(prover.verifyEquivalenceChain([p01, p12, p23])).toEqual({ allValid: true, brokenAt: -1 });

    // Tampering with middle proof in chain reports brokenAt = 1
    const broken = [p01, { ...p12, context: 'altered' }, p23];
    expect(prover.verifyEquivalenceChain(broken)).toEqual({ allValid: false, brokenAt: 1 });

    // Large modular values close to SUBGROUP_Q
    const bigA = prover.commitVector('bigA', [SUBGROUP_Q - 5n, SUBGROUP_Q - 1n, 0n]);
    const bigB = prover.deriveShiftedVector(bigA, 2n, [10n, 2n, 7n], 'bigB');
    expect(bigB.values).toEqual([0n, 0n, 7n]);
    expect(prover.verifyVectorRelation(prover.proveVectorRelation(bigA, bigB, 2n, [10n, 2n, 7n], 'mod-wrap'))).toBe(true);
  });

  it('rejects dimension mismatches in deriveShiftedVector and verifies empty chains cleanly', () => {
    const a = prover.commitVector('chk', [4n, 8n, 12n]);
    expect(() => prover.deriveShiftedVector(a, 1n, [1n, 2n])).toThrow();
    expect(prover.verifyEquivalenceChain([])).toEqual({ allValid: true, brokenAt: -1 });
    const same = prover.deriveShiftedVector(a, 1n, [0n, 0n, 0n]);
    const p = prover.proveVectorRelation(a, same, 1n, [0n, 0n, 0n], 'ident-ctx');
    expect(prover.verifyVectorRelation({ ...p, commA: p.commA.slice(0, 2) })).toBe(false);
    expect(prover.verifyVectorRelation({ ...p, commB: p.commB.slice(0, 2) })).toBe(false);
  });
});
