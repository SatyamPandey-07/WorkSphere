import { describe, it, expect } from 'vitest';
import {
  SuccinctRecursiveRollupVerifier,
  RollupFieldMath,
  ROLLUP_PRIME,
} from '../../core/zkp/SuccinctRecursiveRollupVerifier';

describe('SuccinctRecursiveRollupVerifier', () => {
  const verifier = new SuccinctRecursiveRollupVerifier();

  it('performs accurate modular arithmetic', () => {
    const a = 123456789n;
    const invA = RollupFieldMath.inv(a);
    expect(RollupFieldMath.mul(a, invA)).toBe(1n);
  });

  it('aggregates multiple sequential rollup blocks and verifies the recursive bundle in O(1)', () => {
    // 3 sequential blocks: Block 100, 101, 102
    const root0 = 1000n;
    const root1 = 2000n;
    const root2 = 3000n;
    const root3 = 4000n;

    const b1 = verifier.createBlockProof(100, root0, root1, 'tx_root_100', 11n);
    const b2 = verifier.createBlockProof(101, root1, root2, 'tx_root_101', 22n);
    const b3 = verifier.createBlockProof(102, root2, root3, 'tx_root_102', 33n);

    const blocks = [b1.header, b2.header, b3.header];
    const proofs = [b1.proof, b2.proof, b3.proof];

    const batch = verifier.aggregateBatch('rollup_batch_001', blocks, proofs);

    expect(batch.startBlock).toBe(100);
    expect(batch.endBlock).toBe(102);
    expect(batch.initialPreStateRoot).toBe(root0);
    expect(batch.finalPostStateRoot).toBe(root3);

    const result = verifier.verifyRecursiveBatch(batch);
    expect(result.isValid).toBe(true);
    expect(result.blockCount).toBe(3);
    expect(result.initialPreStateRoot).toBe(root0);
    expect(result.finalPostStateRoot).toBe(root3);
  });

  it('rejects batches with broken state continuity between blocks', () => {
    const b1 = verifier.createBlockProof(10, 100n, 200n, 'tx_10');
    // b2 preStateRoot is 999n instead of 200n! Broken continuity!
    const b2 = verifier.createBlockProof(11, 999n, 300n, 'tx_11');

    expect(() => {
      verifier.aggregateBatch('batch_broken', [b1.header, b2.header], [b1.proof, b2.proof]);
    }).toThrow('State continuity broken');
  });

  it('rejects tampered recursive proofs', () => {
    const b1 = verifier.createBlockProof(1, 10n, 20n, 'tx_1');
    const b2 = verifier.createBlockProof(2, 20n, 30n, 'tx_2');

    const batch = verifier.aggregateBatch('batch_tamper', [b1.header, b2.header], [b1.proof, b2.proof]);

    // Tamper with recursive proof
    const tamperedBatch = {
      ...batch,
      recursiveProof: RollupFieldMath.add(batch.recursiveProof, 1n),
    };

    const result = verifier.verifyRecursiveBatch(tamperedBatch);
    expect(result.isValid).toBe(false);
  });
});
