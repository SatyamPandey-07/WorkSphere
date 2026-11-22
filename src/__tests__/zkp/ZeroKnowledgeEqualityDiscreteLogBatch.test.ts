import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeEqualityDiscreteLogBatch } from '../../core/zkp/ZeroKnowledgeEqualityDiscreteLogBatch';

describe('ZeroKnowledgeEqualityDiscreteLogBatch', () => {
  const prover = new ZeroKnowledgeEqualityDiscreteLogBatch();

  it('produces and verifies constant-size compressed DLEQ proofs across multiple generators', () => {
    const secret = 9876543210123456n;
    const { refBase, refTarget, pairs } = prover.evaluateAcrossGenerators(secret, [
      'epoch-1',
      'epoch-2',
      'epoch-3',
      'epoch-4',
      'epoch-5',
    ]);

    const proof = prover.proveBatchEquality('dleq-batch-01', secret, refBase, refTarget, pairs);
    expect(prover.verifyBatchEquality(proof).valid).toBe(true);

    // Tampering with any target breaks the composite verification equation
    const badPairs = [
      pairs[0],
      { ...pairs[1], targetY: pairs[2].targetY },
      ...pairs.slice(2),
    ];
    const forgedProof = prover.proveBatchEquality('dleq-forged', secret, refBase, refTarget, badPairs);
    expect(prover.verifyBatchEquality(forgedProof).valid).toBe(false);

    expect(
      prover.verifyBatchEquality({ ...proof, responseS: proof.responseS + 1n }).valid
    ).toBe(false);
  });

  it('fast-batch-verifies multi-secret tuples and accurately pinpoints corrupted items', () => {
    const baseA = prover.deriveGenerator('base-A');
    const baseB = prover.deriveGenerator('base-B');
    const tuple = prover.proveMultiSecretTuple('tuple-01', baseA, baseB, [
      { itemId: 'k1', secret: 11111n },
      { itemId: 'k2', secret: 22222n },
      { itemId: 'k3', secret: 33333n },
      { itemId: 'k4', secret: 44444n },
    ]);

    expect(prover.fastBatchVerifyTuple(tuple)).toBe(true);
    expect(prover.locateFaultyTupleItems(tuple)).toEqual([]);

    const corruptedTuple = {
      ...tuple,
      items: [
        tuple.items[0],
        { ...tuple.items[1], response: tuple.items[1].response + 3n },
        tuple.items[2],
        { ...tuple.items[3], targetB: tuple.items[0].targetB },
      ],
    };
    expect(prover.fastBatchVerifyTuple(corruptedTuple)).toBe(false);
    expect(prover.locateFaultyTupleItems(corruptedTuple)).toEqual(['k2', 'k4']);
  });

  it('round-trips JSON serialization for compressed batch DLEQ proofs', () => {
    const secret = 555666777n;
    const { refBase, refTarget, pairs } = prover.evaluateAcrossGenerators(secret, ['a', 'b', 'c']);
    const proof = prover.proveBatchEquality('dleq-ser', secret, refBase, refTarget, pairs);

    const json = prover.serializeBatchProof(proof);
    const decoded = prover.deserializeBatchProof(json);
    expect(decoded).toEqual(proof);
    expect(prover.verifyBatchEquality(decoded).valid).toBe(true);
  });
});
