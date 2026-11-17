/**
 * @file ZKRangeVerifier.test.ts
 * @description Comprehensive test suite for Bulletproofs zero-knowledge range proof verification coordinator,
 * finite field arithmetic over secp256k1 scalar order, Pedersen commitments, and batch verification.
 */

import {
  SECP256K1_ORDER,
  ZKScalarField,
  PedersenGenerators,
  Transcript,
  ZKRangeVerifier,
  BulletproofRangeProof,
} from '../../core/zkp/ZKRangeVerifier';

describe('ZKRangeVerifier & Bulletproofs Cryptographic Engine', () => {
  describe('ZKScalarField', () => {
    it('performs modular addition and subtraction correctly', () => {
      const a = SECP256K1_ORDER - 15n;
      const b = 20n;
      const sum = ZKScalarField.add(a, b);
      expect(sum).toBe(5n);

      const diff = ZKScalarField.sub(5n, 20n);
      expect(diff).toBe(SECP256K1_ORDER - 15n);
    });

    it('performs modular multiplication, exponentiation, and inversion', () => {
      const a = 987654321n;
      const aInv = ZKScalarField.inv(a);
      const prod = ZKScalarField.mul(a, aInv);
      expect(prod).toBe(1n);

      const exp = ZKScalarField.exp(2n, 16n);
      expect(exp).toBe(65536n);
    });

    it('throws error on division by zero', () => {
      expect(() => ZKScalarField.inv(0n)).toThrow('Division by zero in finite field');
    });

    it('generates non-zero random scalars within scalar order bound', () => {
      const s1 = ZKScalarField.randomScalar();
      const s2 = ZKScalarField.randomScalar();
      expect(s1).toBeGreaterThan(0n);
      expect(s1).toBeLessThan(SECP256K1_ORDER);
      expect(s2).toBeGreaterThan(0n);
      expect(s2).toBeLessThan(SECP256K1_ORDER);
      expect(s1).not.toBe(s2);
    });

    it('produces deterministic hash-to-scalar', () => {
      const h1 = ZKScalarField.hashToScalar('test-input', 42n, 100);
      const h2 = ZKScalarField.hashToScalar('test-input', 42n, 100);
      const h3 = ZKScalarField.hashToScalar('different-input');
      expect(h1).toBe(h2);
      expect(h1).not.toBe(h3);
    });
  });

  describe('PedersenGenerators', () => {
    it('provides distinct canonical generators G and H', () => {
      expect(PedersenGenerators.G).toBeDefined();
      expect(PedersenGenerators.H).toBeDefined();
      expect(PedersenGenerators.G).not.toBe(PedersenGenerators.H);
    });

    it('generates deterministic vector bases with domain separation', () => {
      const basesG = PedersenGenerators.generateVectorBases('G', 4);
      const basesH = PedersenGenerators.generateVectorBases('H', 4);

      expect(basesG.length).toBe(4);
      expect(basesH.length).toBe(4);
      expect(basesG[0]).not.toBe(basesH[0]);

      // Same seed produces identical bases
      const basesG2 = PedersenGenerators.generateVectorBases('G', 4);
      expect(basesG[0]).toBe(basesG2[0]);
      expect(basesG[3]).toBe(basesG2[3]);
    });
  });

  describe('Transcript', () => {
    it('generates deterministic challenges given same sequence of labels and values', () => {
      const t1 = new Transcript();
      const t2 = new Transcript();

      t1.append('claim', 12345n);
      t1.append('round', 1);

      t2.append('claim', 12345n);
      t2.append('round', 1);

      const c1 = t1.challengeScalar('u');
      const c2 = t2.challengeScalar('u');
      expect(c1).toBe(c2);
    });

    it('generates distinct challenges when inputs differ', () => {
      const t1 = new Transcript();
      const t2 = new Transcript();

      t1.append('round', 1);
      t2.append('round', 2);

      const c1 = t1.challengeScalar('u');
      const c2 = t2.challengeScalar('u');
      expect(c1).not.toBe(c2);
    });
  });

  describe('ZKRangeVerifier', () => {
    const gamma = ZKScalarField.randomScalar();

    it('generates valid commitment and proves/verifies 64-bit range proof', () => {
      const value = 1250000n; // 1,250,000 units within [0, 2^64 - 1]
      const commitment = ZKRangeVerifier.commitValue(value, gamma);
      expect(commitment).toBeGreaterThan(0n);

      const proof = ZKRangeVerifier.proveRange(value, gamma, 64);
      expect(proof.V).toBe(commitment);
      expect(proof.bitLength).toBe(64);
      expect(proof.innerProduct.L.length).toBe(6); // ceil(log2(64)) = 6
      expect(proof.innerProduct.R.length).toBe(6);

      const isValid = ZKRangeVerifier.verifyRangeProof(commitment, proof, 64);
      expect(isValid).toBe(true);
    });

    it('generates valid proof for 16-bit range bound', () => {
      const value = 54321n; // fits in 16 bits (0 <= 54321 <= 65535)
      const commitment = ZKRangeVerifier.commitValue(value, gamma);
      const proof = ZKRangeVerifier.proveRange(value, gamma, 16);

      expect(proof.innerProduct.L.length).toBe(4); // ceil(log2(16)) = 4
      const isValid = ZKRangeVerifier.verifyRangeProof(commitment, proof, 16);
      expect(isValid).toBe(true);
    });

    it('generates valid proof for 32-bit range bound', () => {
      const value = 3000000000n; // fits in 32 bits (0 <= 3000000000 <= 4294967295)
      const commitment = ZKRangeVerifier.commitValue(value, gamma);
      const proof = ZKRangeVerifier.proveRange(value, gamma, 32);

      expect(proof.innerProduct.L.length).toBe(5); // ceil(log2(32)) = 5
      const isValid = ZKRangeVerifier.verifyRangeProof(commitment, proof, 32);
      expect(isValid).toBe(true);
    });

    it('rejects values out of range during proof generation', () => {
      // 16-bit maximum is 65535
      const outOfRange = 65536n;
      expect(() => {
        ZKRangeVerifier.proveRange(outOfRange, gamma, 16);
      }).toThrow(/out of allowable range/);

      // Negative value
      expect(() => {
        ZKRangeVerifier.proveRange(-1n, gamma, 16);
      }).toThrow(/out of allowable range/);
    });

    it('rejects verification if commitment does not match proof commitment', () => {
      const value = 1000n;
      const commitment = ZKRangeVerifier.commitValue(value, gamma);
      const proof = ZKRangeVerifier.proveRange(value, gamma, 32);

      const tamperedCommitment = ZKScalarField.add(commitment, 1n);
      const isValid = ZKRangeVerifier.verifyRangeProof(tamperedCommitment, proof, 32);
      expect(isValid).toBe(false);
    });

    it('rejects verification if expected bitLength does not match proof', () => {
      const value = 1000n;
      const commitment = ZKRangeVerifier.commitValue(value, gamma);
      const proof = ZKRangeVerifier.proveRange(value, gamma, 16);

      const isValid = ZKRangeVerifier.verifyRangeProof(commitment, proof, 32);
      expect(isValid).toBe(false);
    });

    it('verifies a batch of multiple valid proofs', () => {
      const values = [50n, 2500n, 88888n];
      const bitLength = 32;
      const commitments: bigint[] = [];
      const proofs: BulletproofRangeProof[] = [];

      for (const val of values) {
        const blinder = ZKScalarField.randomScalar();
        const comm = ZKRangeVerifier.commitValue(val, blinder);
        const p = ZKRangeVerifier.proveRange(val, blinder, bitLength);
        commitments.push(comm);
        proofs.push(p);
      }

      const isBatchValid = ZKRangeVerifier.verifyBatch(commitments, proofs, bitLength);
      expect(isBatchValid).toBe(true);
    });

    it('rejects batch verification if any proof in the batch is corrupted', () => {
      const values = [100n, 200n];
      const bitLength = 32;
      const commitments: bigint[] = [];
      const proofs: BulletproofRangeProof[] = [];

      for (const val of values) {
        const blinder = ZKScalarField.randomScalar();
        const comm = ZKRangeVerifier.commitValue(val, blinder);
        const p = ZKRangeVerifier.proveRange(val, blinder, bitLength);
        commitments.push(comm);
        proofs.push(p);
      }

      // Corrupt one commitment
      commitments[1] = ZKScalarField.add(commitments[1], 1n);

      const isBatchValid = ZKRangeVerifier.verifyBatch(commitments, proofs, bitLength);
      expect(isBatchValid).toBe(false);
    });

    it('rejects batch verification on mismatched array lengths or empty arrays', () => {
      expect(ZKRangeVerifier.verifyBatch([], [])).toBe(false);
      expect(ZKRangeVerifier.verifyBatch([1n], [])).toBe(false);
    });
  });
});
