/**
 * @file PietrzakVDFEngine.test.ts
 * @description Unit tests for Verifiable Delay Function (VDF) with Pietrzak Recursive Halving Protocol,
 * sequential squaring verification, unbiasable randomness beacon generation, and slot leader election.
 */

import {
  VDFGroupMath,
  PietrzakVDFEngine,
  DEFAULT_VDF_MODULUS,
} from '../../core/consensus/PietrzakVDFEngine';

describe('PietrzakVDFEngine & Consensus Randomness Suite', () => {
  describe('VDFGroupMath', () => {
    const N = DEFAULT_VDF_MODULUS;

    it('performs modular arithmetic and exponentiation in Z_N*', () => {
      const a = 123456789n;
      const b = 987654321n;
      const prod = VDFGroupMath.mul(a, b, N);
      expect(prod).toBeGreaterThan(0n);
      expect(prod).toBeLessThan(N);

      // 2^10 = 1024
      const expVal = VDFGroupMath.exp(2n, 10n, N);
      expect(expVal).toBe(1024n);
    });

    it('deterministically hashes seeds into non-trivial elements of Z_N*', () => {
      const g1 = VDFGroupMath.hashToGroup('worksphere-seed-alpha', N);
      const g2 = VDFGroupMath.hashToGroup('worksphere-seed-alpha', N);
      const g3 = VDFGroupMath.hashToGroup('worksphere-seed-beta', N);

      expect(g1).toBe(g2);
      expect(g1).not.toBe(g3);
      expect(g1).toBeGreaterThan(2n);
      expect(g1).toBeLessThan(N - 1n);
    });

    it('computes 128-bit Fiat-Shamir challenge scalars', () => {
      const x = 500n;
      const y = 250000n;
      const v = 5000n;

      const c1 = VDFGroupMath.computeChallenge(x, y, v, N);
      const c2 = VDFGroupMath.computeChallenge(x, y, v, N);
      const c3 = VDFGroupMath.computeChallenge(x, y + 1n, v, N);

      expect(c1).toBe(c2);
      expect(c1).not.toBe(c3);
      expect(c1).toBeGreaterThan(0n);
      // Fits in 128 bits
      expect(c1).toBeLessThan(1n << 128n);
    });
  });

  describe('PietrzakVDFEngine Evaluation & Logarithmic Verification', () => {
    const engine = new PietrzakVDFEngine();
    const x = VDFGroupMath.hashToGroup('epoch-slot-100');

    it('evaluates and verifies VDF with delay parameter T=4 (2 halving rounds)', () => {
      const evaluation = engine.evaluate(x, 4);

      expect(evaluation.T).toBe(4);
      expect(evaluation.proof.length).toBe(2); // log2(4) = 2
      expect(evaluation.y).toBeGreaterThan(0n);

      const verification = engine.verify(x, evaluation.y, 4, evaluation.proof);
      expect(verification.valid).toBe(true);
      expect(verification.rounds).toBe(2);
      expect(verification.error).toBeUndefined();
    });

    it('evaluates and verifies VDF with delay parameter T=16 (4 halving rounds)', () => {
      const evaluation = engine.evaluate(x, 16);

      expect(evaluation.T).toBe(16);
      expect(evaluation.proof.length).toBe(4); // log2(16) = 4

      const verification = engine.verify(x, evaluation.y, 16, evaluation.proof);
      expect(verification.valid).toBe(true);
      expect(verification.rounds).toBe(4);
    });

    it('evaluates and verifies VDF with delay parameter T=64 (6 halving rounds)', () => {
      const evaluation = engine.evaluate(x, 64);

      expect(evaluation.T).toBe(64);
      expect(evaluation.proof.length).toBe(6); // log2(64) = 6

      const verification = engine.verify(x, evaluation.y, 64, evaluation.proof);
      expect(verification.valid).toBe(true);
      expect(verification.rounds).toBe(6);
    });

    it('rejects evaluation when T is not a power of 2', () => {
      expect(() => {
        engine.evaluate(x, 5);
      }).toThrow(/must be a power of 2/);

      expect(() => {
        engine.evaluate(x, 0);
      }).toThrow(/must be a power of 2/);
    });

    it('rejects verification when final output y is tampered', () => {
      const evaluation = engine.evaluate(x, 16);
      const tamperedY = VDFGroupMath.add(evaluation.y, 1n, engine.getModulus());

      const verification = engine.verify(x, tamperedY, 16, evaluation.proof);
      expect(verification.valid).toBe(false);
      expect(verification.error).toContain('failed');
    });

    it('rejects verification when midpoint proof element is corrupted', () => {
      const evaluation = engine.evaluate(x, 16);
      const corruptedProof = [...evaluation.proof];
      corruptedProof[1] = VDFGroupMath.add(corruptedProof[1], 1n, engine.getModulus());

      const verification = engine.verify(x, evaluation.y, 16, corruptedProof);
      expect(verification.valid).toBe(false);
      expect(verification.error).toContain('failed');
    });

    it('rejects verification when proof length does not match log2(T)', () => {
      const evaluation = engine.evaluate(x, 16);
      const truncatedProof = evaluation.proof.slice(0, 2);

      const verification = engine.verify(x, evaluation.y, 16, truncatedProof);
      expect(verification.valid).toBe(false);
      expect(verification.error).toContain('Expected 4 proof elements');
    });
  });

  describe('Consensus Randomness Beacon & Leader Election', () => {
    const engine = new PietrzakVDFEngine();
    const x = VDFGroupMath.hashToGroup('slot-anchor-2026');

    it('generates deterministic unbiasable beacon seed for a given slot height', () => {
      const evaluation = engine.evaluate(x, 8);
      const seed1 = engine.generateBeaconSeed(evaluation, 10500);
      const seed2 = engine.generateBeaconSeed(evaluation, 10500);
      const seedDiffSlot = engine.generateBeaconSeed(evaluation, 10501);

      expect(seed1).toBe(seed2);
      expect(seed1).not.toBe(seedDiffSlot);
      expect(seed1.length).toBe(64); // SHA-256 hex
    });

    it('selects slot leader fairly and deterministically from candidate list', () => {
      const evaluation = engine.evaluate(x, 8);
      const seed = engine.generateBeaconSeed(evaluation, 10500);
      const candidates = ['validator-node-1', 'validator-node-2', 'validator-node-3', 'validator-node-4'];

      const leader1 = engine.selectSlotLeader(candidates, seed);
      const leader2 = engine.selectSlotLeader(candidates, seed);

      expect(leader1).toBe(leader2);
      expect(candidates).toContain(leader1);
    });

    it('throws error when candidate list is empty', () => {
      const evaluation = engine.evaluate(x, 8);
      const seed = engine.generateBeaconSeed(evaluation, 10500);

      expect(() => {
        engine.selectSlotLeader([], seed);
      }).toThrow(/cannot be empty/);
    });
  });
});
