import { ChaumPedersenBatchVerifier } from '../../core/zkp/ChaumPedersenBatchVerifier';

describe('ChaumPedersenBatchVerifier', () => {
  it('batch-verifies heterogeneous Chaum-Pedersen DLEQ statements and rejects single bad statement', () => {
    const verifier = new ChaumPedersenBatchVerifier();
    const proofs = [1, 2, 3, 4, 5].map((i) => {
      const g = verifier.deriveGenerator(`G-${i}`);
      const h = verifier.deriveGenerator(`H-${i}`);
      const x = BigInt(i * 1234567 + 99);
      const st = verifier.createStatement(`stmt-${i}`, g, h, x);
      return verifier.proveSingle(st, x, `nonce-${i}`);
    });

    for (const p of proofs) {
      expect(verifier.verifySingle(p)).toBe(true);
    }

    const batchRes = verifier.verifyBatch(proofs);
    expect(batchRes.isValid).toBe(true);
    expect(batchRes.batchSize).toBe(5);

    // Corrupt a single proof inside the batch
    const corrupted = proofs.map((p, idx) =>
      idx === 3 ? { ...p, responseS: p.responseS + 1n } : p
    );
    expect(verifier.verifyBatch(corrupted).isValid).toBe(false);
  });

  it('proves and verifies compressed shared-witness DLEQ across k independent bases', () => {
    const verifier = new ChaumPedersenBatchVerifier();
    const bases = ['B1', 'B2', 'B3', 'B4'].map((l) => verifier.deriveGenerator(l));
    const proof = verifier.proveSharedWitnessBatch(bases, 987654321n, 'shared-n1');

    expect(verifier.verifySharedWitnessBatch(proof)).toBe(true);
    expect(
      verifier.verifySharedWitnessBatch({
        ...proof,
        pairs: [
          { ...proof.pairs[0], target: proof.pairs[0].target + 1n },
          ...proof.pairs.slice(1),
        ],
      })
    ).toBe(false);
  });
});
