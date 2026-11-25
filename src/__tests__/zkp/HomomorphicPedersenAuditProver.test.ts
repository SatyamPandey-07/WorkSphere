import { describe, it, expect } from 'vitest';
import { HomomorphicPedersenAuditProver } from '../../core/zkp/HomomorphicPedersenAuditProver';

describe('HomomorphicPedersenAuditProver', () => {
  const prover = new HomomorphicPedersenAuditProver();

  it('verifies valid bit OR-proofs for 0 and 1 and rejects tampered commitments', () => {
    const p0 = prover.proveBit(0n, 123456789n, 'bit-test-0');
    const p1 = prover.proveBit(1n, 987654321n, 'bit-test-1');

    expect(prover.verifyBit(p0, 'bit-test-0')).toBe(true);
    expect(prover.verifyBit(p1, 'bit-test-1')).toBe(true);
    expect(prover.verifyBit(p0, 'wrong-context')).toBe(false);
    expect(prover.verifyBit({ ...p1, z0: p1.z0 + 1n }, 'bit-test-1')).toBe(false);
  });

  it('proves and verifies non-negative range commitments and rejects out-of-range values', () => {
    const blinding = 42424242n;
    const value = 319n;
    const commitment = prover.commit(value, blinding);
    const rangeProof = prover.proveRange(value, blinding, 12, 'range-ctx');

    expect(prover.verifyRange(commitment, rangeProof, 'range-ctx')).toBe(true);
    expect(prover.verifyRange(commitment + 1n, rangeProof, 'range-ctx')).toBe(false);
    expect(() => prover.proveRange(-1n, blinding, 12, 'neg')).toThrow(RangeError);
    expect(() => prover.proveRange(5000n, blinding, 12, 'overflow')).toThrow(RangeError);
  });

  it('generates and verifies a homomorphic multi-department audit bundle', () => {
    const bundle = prover.generateAuditBundle(
      'epoch-2026-q4',
      [
        { accountId: 'eng-infra', amount: 1250n },
        { accountId: 'sec-ops', amount: 840n },
        { accountId: 'workspace-iot', amount: 410n },
      ],
      12
    );

    expect(bundle.conservationProof.declaredTotal).toBe(2500n);
    const result = prover.verifyAuditBundle(bundle);
    expect(result.valid).toBe(true);
    expect(result.verifiedEntries).toBe(3);
  });

  it('detects tampered declared totals and mutated entry commitments', () => {
    const bundle = prover.generateAuditBundle(
      'epoch-tamper',
      [
        { accountId: 'dept-a', amount: 100n },
        { accountId: 'dept-b', amount: 200n },
      ],
      10
    );

    const forgedTotal = {
      ...bundle,
      conservationProof: {
        ...bundle.conservationProof,
        declaredTotal: 301n,
      },
    };
    expect(prover.verifyAuditBundle(forgedTotal).valid).toBe(false);

    const mutatedEntry = {
      ...bundle,
      entries: [
        { ...bundle.entries[0], commitment: bundle.entries[0].commitment + 2n },
        bundle.entries[1],
      ],
    };
    expect(prover.verifyAuditBundle(mutatedEntry).valid).toBe(false);
  });

  it('batch-verifies multiple audit epochs and rejects batches with a single invalid epoch', () => {
    const b1 = prover.generateAuditBundle(
      'epoch-1',
      [
        { accountId: 'a1', amount: 50n },
        { accountId: 'a2', amount: 75n },
      ],
      8
    );
    const b2 = prover.generateAuditBundle(
      'epoch-2',
      [
        { accountId: 'b1', amount: 120n },
        { accountId: 'b2', amount: 30n },
      ],
      8
    );

    const ok = prover.verifyBatch([b1, b2]);
    expect(ok.valid).toBe(true);
    expect(ok.verifiedEntries).toBe(4);

    const badB2 = {
      ...b2,
      conservationProof: {
        ...b2.conservationProof,
        responseBlinding: b2.conservationProof.responseBlinding + 1n,
      },
    };
    expect(prover.verifyBatch([b1, badB2]).valid).toBe(false);
  });
});
