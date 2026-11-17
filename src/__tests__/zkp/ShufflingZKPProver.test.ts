import { describe, it, expect, beforeEach } from 'vitest';
import {
  ShufflingZKPProver,
  BN254_PRIME,
} from '../../core/zkp/ShufflingZKPProver';
import type {
  PedersenCommitment,
  ShuffleProof,
} from '../../core/zkp/ShufflingZKPProver';

describe('ShufflingZKPProver - Zero-Knowledge Verifiable Shuffle & Re-Randomization', () => {
  let prover: ShufflingZKPProver;

  beforeEach(() => {
    prover = new ShufflingZKPProver({
      prime: BN254_PRIME,
      powDifficultyBits: 8,
    });
  });

  function createCommitment(message: bigint, blinding: bigint): PedersenCommitment {
    const c = prover.commit(message, blinding);
    return { commitment: c, message, blinding };
  }

  describe('Pedersen Commitment & Re-randomization Primitives', () => {
    it('creates deterministic commitment and correct re-randomization', () => {
      const comm = createCommitment(42n, 12345n);
      expect(comm.commitment).toBeGreaterThan(0n);
      expect(comm.commitment).toBeLessThan(BN254_PRIME);

      const rho = 999n;
      const reRand = prover.reRandomize(comm.commitment, rho);
      // C' should equal commit(42, 12345 + 999)
      const expected = prover.commit(42n, 12345n + rho);
      expect(reRand).toBe(expected);
    });
  });

  describe('Shuffle Proof Generation & Verification', () => {
    it('proves and verifies a valid 4-element commitment shuffle', () => {
      const inputs: PedersenCommitment[] = [
        createCommitment(10n, 101n),
        createCommitment(20n, 202n),
        createCommitment(30n, 303n),
        createCommitment(40n, 404n),
      ];

      // Permutation: [2, 0, 3, 1] (maps input 2->0, 0->1, 3->2, 1->3)
      const permutation = [2, 0, 3, 1];
      const rerandomizers = [11n, 22n, 33n, 44n];

      const proof = prover.generateProof(inputs, permutation, rerandomizers);
      expect(proof.shuffledCommitments).toHaveLength(4);

      const isValid = prover.verifyProof(proof);
      expect(isValid).toBe(true);
    });

    it('rejects proof with tampered shuffled commitment', () => {
      const inputs: PedersenCommitment[] = [
        createCommitment(5n, 55n),
        createCommitment(15n, 155n),
        createCommitment(25n, 255n),
      ];
      const permutation = [1, 2, 0];
      const rerandomizers = [10n, 20n, 30n];

      const proof = prover.generateProof(inputs, permutation, rerandomizers);

      // Tamper with one shuffled commitment
      const tamperedProof: ShuffleProof = {
        ...proof,
        shuffledCommitments: [
          (proof.shuffledCommitments[0] + 1n) % BN254_PRIME,
          proof.shuffledCommitments[1],
          proof.shuffledCommitments[2],
        ],
      };

      const isValid = prover.verifyProof(tamperedProof);
      expect(isValid).toBe(false);
    });

    it('rejects proof with forged response s', () => {
      const inputs = [createCommitment(1n, 10n), createCommitment(2n, 20n)];
      const proof = prover.generateProof(inputs, [1, 0], [5n, 7n]);

      const forgedProof: ShuffleProof = {
        ...proof,
        response: (proof.response + 1337n) % (BN254_PRIME - 1n),
      };

      expect(prover.verifyProof(forgedProof)).toBe(false);
    });

    it('throws error when permutation is not a valid bijection', () => {
      const inputs = [createCommitment(1n, 10n), createCommitment(2n, 20n)];
      expect(() => {
        prover.generateProof(inputs, [0, 0], [1n, 2n]); // Duplicate index 0
      }).toThrow('Invalid permutation');
    });
  });
});
