import { describe, it, expect } from 'vitest';
import {
  ReedSolomonErasureProver,
  RSDASFieldMath,
} from '../../core/zkp/ReedSolomonErasureProver';

describe('ReedSolomonErasureProver', () => {
  const prover = new ReedSolomonErasureProver(32, 77777n);

  it('encodes systematic Reed-Solomon shares and verifies O(1) DAS proofs', () => {
    const dataChunks = [101n, 202n, 303n, 404n];
    const encoded = prover.encodeBlock(dataChunks, 2);

    expect(encoded.originalLength).toBe(4);
    expect(encoded.encodedLength).toBe(8);

    // First 4 shares match systematic data chunks identically
    for (let i = 0; i < 4; i++) {
      expect(encoded.shares[i].value).toBe(dataChunks[i]);
    }

    // Verify all 8 shares with O(1) KZG opening proofs
    for (let idx = 0; idx < 8; idx++) {
      const sample = prover.generateSampleProof(encoded, idx);
      const res = prover.verifySample(encoded.commitment, sample);
      expect(res.isValid).toBe(true);
    }
  });

  it('reconstructs exact original data from parity-only shares under 50% erasure loss', () => {
    const dataChunks = [11n, 22n, 33n, 44n, 55n];
    const encoded = prover.encodeBlock(dataChunks, 2);

    // Drop ALL 5 original systematic shares [0..4] and keep ONLY the 5 parity shares [5..9]!
    const paritySamples = [5, 6, 7, 8, 9].map((idx) => prover.generateSampleProof(encoded, idx));

    const recovered = prover.reconstructOriginalData(paritySamples, 5, encoded.commitment);
    expect(recovered).toEqual(dataChunks);
  });

  it('rejects corrupted or forged DAS shares', () => {
    const encoded = prover.encodeBlock([50n, 60n, 70n, 80n], 2);
    const sample = prover.generateSampleProof(encoded, 6);

    const corrupted = {
      ...sample,
      value: RSDASFieldMath.add(sample.value, 1n),
    };
    expect(prover.verifySample(encoded.commitment, corrupted).isValid).toBe(false);
  });
});
