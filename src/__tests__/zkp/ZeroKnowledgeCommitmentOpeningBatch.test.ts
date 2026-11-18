import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeCommitmentOpeningBatch } from '../../core/zkp/ZeroKnowledgeCommitmentOpeningBatch';

describe('ZeroKnowledgeCommitmentOpeningBatch', () => {
  const prover = new ZeroKnowledgeCommitmentOpeningBatch();

  it('compresses N Pedersen commitment openings into a single O(1) batch proof', () => {
    const items = [100n, 250n, 75n, 420n, 88n].map((v, i) => prover.commit(`c-${i}`, v));
    for (const it of items) expect(prover.verifyDirectOpening(it)).toBe(true);

    const batchProof = prover.proveBatchOpening('batch-01', items);
    expect(prover.verifyBatchOpening(batchProof)).toBe(true);
    expect(prover.verifyBatchOpening({ ...batchProof, responseVal: batchProof.responseVal + 1n })).toBe(false);

    const json = prover.serializeBatchProof(batchProof);
    const restored = prover.deserializeBatchProof(json);
    expect(restored).toEqual(batchProof);
    expect(prover.verifyBatchOpening(restored)).toBe(true);
  });

  it('proves hidden sum conservation and equality of independently blinded commitments', () => {
    const inputs = [prover.commit('in1', 600n), prover.commit('in2', 400n)];
    const outputs = [prover.commit('out1', 350n), prover.commit('out2', 640n)];
    const fee = 10n; // 600 + 400 == 350 + 640 + 10

    const cons = prover.proveSumConservation('cons-1', inputs, outputs, fee);
    expect(prover.verifySumConservation(cons)).toBe(true);
    expect(prover.verifySumConservation({ ...cons, publicAdjustment: 11n })).toBe(false);
    expect(() => prover.proveSumConservation('cons-bad', inputs, outputs, 15n)).toThrow();

    const eqA = prover.commit('a', 999n);
    const eqB = prover.commit('b', 999n);
    expect(eqA.commitment).not.toBe(eqB.commitment);
    const eqProof = prover.proveEquality('eq-999', eqA, eqB);
    expect(prover.verifyEquality(eqProof)).toBe(true);
    expect(prover.verifyEquality({ ...eqProof, responseDeltaBlind: eqProof.responseDeltaBlind + 1n })).toBe(false);
  });
});
