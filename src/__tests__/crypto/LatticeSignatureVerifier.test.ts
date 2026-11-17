/**
 * @file LatticeSignatureVerifier.test.ts
 * @description Comprehensive unit test suite for LatticeSignatureVerifier post-quantum ML-DSA
 * Crystals-Dilithium signature verification, polynomial ring arithmetic, and hint reconstruction.
 */

import {
  LatticeSignatureVerifier,
  PolyRing,
  DILITHIUM_Q,
  DILITHIUM_N,
  DILITHIUM_2,
  DILITHIUM_3,
  DILITHIUM_5,
  type DilithiumParams,
  type DilithiumPublicKey,
  type DilithiumSignature
} from '../../core/crypto/LatticeSignatureVerifier';

describe('LatticeSignatureVerifier Post-Quantum Digital Signature Engine', () => {
  let verifier: LatticeSignatureVerifier;

  beforeEach(() => {
    verifier = new LatticeSignatureVerifier(DILITHIUM_3);
  });

  describe('Polynomial Ring Arithmetic over R_q', () => {
    it('performs signed and canonical modulo reductions correctly', () => {
      expect(PolyRing.modQ(10, DILITHIUM_Q)).toBe(10);
      expect(PolyRing.modQ(-5, DILITHIUM_Q)).toBe(DILITHIUM_Q - 5);
      expect(PolyRing.freezeSigned(10, DILITHIUM_Q)).toBe(10);
      expect(PolyRing.freezeSigned(DILITHIUM_Q - 10, DILITHIUM_Q)).toBe(-10);
    });

    it('performs negacyclic polynomial multiplication modulo (X^256 + 1)', () => {
      const a = new Int32Array(DILITHIUM_N);
      const b = new Int32Array(DILITHIUM_N);

      // (2 + 3X) * (4 + 5X) = 8 + 22X + 15X^2
      a[0] = 2;
      a[1] = 3;
      b[0] = 4;
      b[1] = 5;

      const c = PolyRing.mulPoly(a, b);
      expect(c[0]).toBe(8);
      expect(c[1]).toBe(22);
      expect(c[2]).toBe(15);
      expect(c[3]).toBe(0);
    });

    it('wraps high-degree polynomial coefficients with negacyclic negation', () => {
      const a = new Int32Array(DILITHIUM_N);
      const b = new Int32Array(DILITHIUM_N);

      // X^255 * X = X^256 = -1 mod (X^256 + 1)
      a[255] = 1;
      b[1] = 1;

      const c = PolyRing.mulPoly(a, b);
      expect(c[0]).toBe(DILITHIUM_Q - 1); // -1 mod q
    });

    it('computes correct infinity norm for polynomials', () => {
      const poly = new Int32Array(DILITHIUM_N);
      poly[0] = 15;
      poly[5] = -42;
      poly[10] = DILITHIUM_Q - 100; // -100

      expect(PolyRing.infinityNorm(poly)).toBe(100);
    });
  });

  describe('High/Low Bits Decomposition & Hint Reconstruction', () => {
    it('decomposes integer r into (r1, r0) and reconstructs via UseHint with zero hint bit', () => {
      const gamma2 = DILITHIUM_3.gamma2;
      const r = 500000;
      const { r1, r0 } = PolyRing.decompose(r, gamma2);

      expect(r1).toBeGreaterThanOrEqual(0);
      expect(Math.abs(r0)).toBeLessThanOrEqual(gamma2);

      // Hint bit = 0 returns r1 directly
      const reconstructed = PolyRing.useHint(0, r, gamma2);
      expect(reconstructed).toBe(r1);
    });
  });

  describe('Post-Quantum Signature Verification', () => {
    it('verifies a valid post-quantum Dilithium3 signature', () => {
      const message = 'Confidential workspace lease agreement contract #9021';
      const { publicKey, signature } = verifier.generateMockSignedPair(message, DILITHIUM_3);

      const result = verifier.verify(publicKey, message, signature);

      expect(result.valid).toBe(true);
      expect(result.algorithm).toBe(DILITHIUM_3.name);
      expect(result.zInfinityNorm).toBeLessThan(DILITHIUM_3.gamma1 - DILITHIUM_3.beta);
      expect(result.hintWeight).toBeLessThanOrEqual(DILITHIUM_3.omega);
      expect(result.error).toBeUndefined();
    });

    it('rejects signature if message content has been tampered', () => {
      const originalMessage = 'Transfer 100 corporate credits to desk #4';
      const tamperedMessage = 'Transfer 999 corporate credits to desk #4';
      const { publicKey, signature } = verifier.generateMockSignedPair(originalMessage, DILITHIUM_3);

      const result = verifier.verify(publicKey, tamperedMessage, signature);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Challenge hash verification mismatch');
    });

    it('rejects signature when z vector infinity norm exceeds security bound', () => {
      const message = 'Audit token release authorization';
      const { publicKey, signature } = verifier.generateMockSignedPair(message, DILITHIUM_3);

      // Inject malicious out-of-bounds noise into z
      signature.z[0][0] = DILITHIUM_3.gamma1; // Exceeds (gamma1 - beta)

      const result = verifier.verify(publicKey, message, signature);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('exceeds bound');
    });

    it('rejects signature when hint weight exceeds omega limit', () => {
      const message = 'Executive biometric gateway unlock';
      const { publicKey, signature } = verifier.generateMockSignedPair(message, DILITHIUM_3);

      // Set excessive hint bits exceeding omega (55 for Dilithium3)
      for (let i = 0; i < 60; i++) {
        signature.h[0][i] = 1;
      }

      const result = verifier.verify(publicKey, message, signature);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Hint weight');
    });

    it('supports multiple NIST security levels (Dilithium2, Dilithium3, Dilithium5)', () => {
      const message = 'Multi-tier post-quantum verification check';

      const v2 = new LatticeSignatureVerifier(DILITHIUM_2);
      const pair2 = v2.generateMockSignedPair(message, DILITHIUM_2);
      expect(v2.verify(pair2.publicKey, message, pair2.signature).valid).toBe(true);

      const v5 = new LatticeSignatureVerifier(DILITHIUM_5);
      const pair5 = v5.generateMockSignedPair(message, DILITHIUM_5);
      expect(v5.verify(pair5.publicKey, message, pair5.signature).valid).toBe(true);
    });
  });
});
