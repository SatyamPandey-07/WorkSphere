import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeSchnorrMultiProofProver, SAFE_PRIME_P, SUBGROUP_Q } from '../../core/zkp/ZeroKnowledgeSchnorrMultiProofProver';

describe('ZeroKnowledgeSchnorrMultiProofProver', () => {
  const prover = new ZeroKnowledgeSchnorrMultiProofProver();

  it('verifies multi-base Schnorr batches on fast path and isolates forged proofs via binary search', () => {
    const gens = prover.deriveGenerators(4, 'AUDIT-BASIS-2026');
    const proofs = Array.from({ length: 8 }, (_, idx) =>
      prover.prove(
        `proof-${idx}`,
        gens,
        [BigInt(idx + 10), BigInt(idx * 3 + 7), BigInt(idx * 11 + 5), BigInt(99 - idx)],
        'batch-round-1',
      ),
    );

    const fastReport = prover.verifyBatchWithFaultIsolation(proofs);
    expect(fastReport.allValid).toBe(true);
    expect(fastReport.usedFastBatchPath).toBe(true);
    expect(fastReport.totalChecked).toBe(8);
    expect(fastReport.invalidProofIds).toEqual([]);

    const mixed = proofs.map((p, idx) =>
      idx === 2 || idx === 6
        ? { ...p, responses: p.responses.map((r, j) => (j === 0 ? (r + 1n) % SUBGROUP_Q : r)) }
        : p,
    );
    const faultReport = prover.verifyBatchWithFaultIsolation(mixed);
    expect(faultReport.allValid).toBe(false);
    expect(faultReport.usedFastBatchPath).toBe(false);
    expect(faultReport.invalidProofIds).toEqual(['proof-2', 'proof-6']);

    const json = JSON.parse(prover.serializeProof(proofs[0])) as { id: string; generatorCount: number };
    expect(json.id).toBe('proof-0');
    expect(json.generatorCount).toBe(4);
  });

  it('handles single-generator proofs, zero secrets, empty batches, and heterogeneous generator bases', () => {
    const empty = prover.verifyBatchWithFaultIsolation([]);
    expect(empty).toEqual({ allValid: true, totalChecked: 0, invalidProofIds: [], usedFastBatchPath: true });

    const g1 = prover.deriveGenerators(1, 'SINGLE-GEN');
    const singleZero = prover.prove('zero-secret', g1, [0n], 'zero-ctx');
    expect(prover.verifySingle(singleZero)).toBe(true);
    expect(singleZero.statement.targetY).toBe(1n);

    // Heterogeneous generator bases with same length fall back cleanly to individual verification
    const basisA = prover.deriveGenerators(3, 'BASIS-A');
    const basisB = prover.deriveGenerators(3, 'BASIS-B');
    const pA = prover.prove('het-a', basisA, [11n, 22n, 33n], 'het');
    const pB = prover.prove('het-b', basisB, [44n, 55n, 66n], 'het');
    const hetValid = prover.verifyBatchWithFaultIsolation([pA, pB]);
    expect(hetValid.allValid).toBe(true);
    expect(hetValid.invalidProofIds).toEqual([]);

    const pBBad = { ...pB, challenge: (pB.challenge + 1n) % SUBGROUP_Q };
    const hetFault = prover.verifyBatchWithFaultIsolation([pA, pBBad]);
    expect(hetFault.allValid).toBe(false);
    expect(hetFault.invalidProofIds).toEqual(['het-b']);
  });

  it('rejects malformed parameters and every single tampered proof attribute', () => {
    expect(() => prover.deriveGenerators(0)).toThrow();
    expect(() => prover.computeTarget([], [])).toThrow();
    expect(() => prover.computeTarget([4n, 9n], [1n])).toThrow();

    const gens = prover.deriveGenerators(3, 'TAMPER-BASIS');
    const p = prover.prove('strict-1', gens, [100n, 200n, 300n], 'ctx-a');
    expect(prover.verifySingle(p)).toBe(true);

    expect(prover.verifySingle({ ...p, announcementR: (p.announcementR * 4n) % SAFE_PRIME_P })).toBe(false);
    expect(prover.verifySingle({ ...p, challenge: (p.challenge + 1n) % SUBGROUP_Q })).toBe(false);
    expect(prover.verifySingle({ ...p, responses: p.responses.slice(0, 2) })).toBe(false);
    expect(prover.verifySingle({ ...p, statement: { ...p.statement, context: 'ctx-b' } })).toBe(false);
    expect(prover.verifySingle({ ...p, statement: { ...p.statement, id: 'strict-2' } })).toBe(false);
    expect(prover.verifySingle({ ...p, statement: { ...p.statement, targetY: (p.statement.targetY * 4n) % SAFE_PRIME_P } })).toBe(false);
    expect(prover.verifySingle({ ...p, statement: { ...p.statement, generators: [] } })).toBe(false);
  });

  it('isolates faults accurately when ALL proofs in a batch or only boundary proofs are corrupted', () => {
    const gens = prover.deriveGenerators(2, 'STRESS-BASIS');
    const batch = Array.from({ length: 6 }, (_, i) =>
      prover.prove(`s-${i}`, gens, [BigInt(i + 1), BigInt(i * 5 + 3)], 'stress'),
    );

    // Corrupt first and last
    const boundaryBad = batch.map((p, i) =>
      i === 0 || i === 5 ? { ...p, announcementR: (p.announcementR * 4n) % SAFE_PRIME_P } : p,
    );
    const bRep = prover.verifyBatchWithFaultIsolation(boundaryBad);
    expect(bRep.allValid).toBe(false);
    expect(bRep.invalidProofIds).toEqual(['s-0', 's-5']);

    // Corrupt every proof
    const allBad = batch.map((p) => ({ ...p, challenge: (p.challenge + 3n) % SUBGROUP_Q }));
    const allRep = prover.verifyBatchWithFaultIsolation(allBad);
    expect(allRep.allValid).toBe(false);
    expect(allRep.invalidProofIds).toEqual(['s-0', 's-1', 's-2', 's-3', 's-4', 's-5']);
  });

  it('deterministically derives identical generators for the same domain and distinct ones across domains', () => {
    const gA1 = prover.deriveGenerators(5, 'DOM-ALPHA');
    const gA2 = prover.deriveGenerators(5, 'DOM-ALPHA');
    const gB = prover.deriveGenerators(5, 'DOM-BETA');
    expect(gA1).toEqual(gA2);
    expect(gA1).not.toEqual(gB);
    expect(new Set(gA1).size).toBe(5);

    const p1 = prover.prove('m1', gA1, [1n, 2n, 3n, 4n, 5n], 'c1');
    const p2 = prover.prove('m2', gA1, [5n, 4n, 3n, 2n, 1n], 'c2');
    expect(prover.verifyBatchWithFaultIsolation([p1, p2]).allValid).toBe(true);
  });

  it('scales cleanly to 16-proof batches with multiple scattered faults and large scalar secrets', () => {
    const gens = prover.deriveGenerators(3, 'LARGE-BATCH-16');
    const base = 0x123456789abcdef0n;
    const proofs = Array.from({ length: 16 }, (_, idx) =>
      prover.prove(
        `big-${idx}`,
        gens,
        [base + BigInt(idx), base * 2n + BigInt(idx * 7), base * 3n + BigInt(idx * 13)],
        `ctx-${idx}`,
      ),
    );
    const ok = prover.verifyBatchWithFaultIsolation(proofs);
    expect(ok.allValid).toBe(true);
    expect(ok.totalChecked).toBe(16);
    expect(ok.usedFastBatchPath).toBe(true);

    const faulty = proofs.map((p, i) =>
      i === 1 || i === 7 || i === 14
        ? { ...p, responses: p.responses.map((r, j) => (j === 2 ? (r + 5n) % SUBGROUP_Q : r)) }
        : p,
    );
    const rep = prover.verifyBatchWithFaultIsolation(faulty);
    expect(rep.allValid).toBe(false);
    expect(rep.usedFastBatchPath).toBe(false);
    expect(rep.invalidProofIds).toEqual(['big-1', 'big-7', 'big-14']);
  });
});
