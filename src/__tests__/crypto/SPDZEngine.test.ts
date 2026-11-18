import { describe, it, expect, beforeEach } from 'vitest';
import { SPDZEngine, SPDZ_PRIME } from '../../core/crypto/SPDZEngine';

describe('SPDZEngine - Verifiable Multi-Party Computation & Beaver Triplets', () => {
  let mpc: SPDZEngine;

  beforeEach(() => {
    mpc = new SPDZEngine(3); // 3-party MPC
  });

  describe('Authenticated Secret Sharing & Reconstruction', () => {
    it('splits secret into 3 authenticated shares and reconstructs faithfully', () => {
      const secret = 42_000_000n;
      const shares = mpc.share(secret);

      expect(shares.size).toBe(3);
      const opened = mpc.open(shares);
      expect(opened).toBe(secret);
    });

    it('detects tampering with value share and aborts via MAC verification failure', () => {
      const secret = 1337n;
      const shares = mpc.share(secret);

      // Tamper with party 1's share
      const p1 = shares.get(1)!;
      shares.set(1, { ...p1, valueShare: p1.valueShare + 1n });

      expect(() => mpc.open(shares)).toThrowError(/MAC Verification Failed/i);
    });

    it('detects tampering with MAC share and aborts', () => {
      const secret = 9999n;
      const shares = mpc.share(secret);

      // Tamper with party 2's MAC share
      const p2 = shares.get(2)!;
      shares.set(2, { ...p2, macShare: p2.macShare + 1n });

      expect(() => mpc.open(shares)).toThrowError(/MAC Verification Failed/i);
    });
  });

  describe('Homomorphic Addition & Scalar Multiplication Gates', () => {
    it('evaluates addition gate [x + y] = [x] + [y] with valid MAC', () => {
      const x = 500n;
      const y = 700n;

      const shareX = mpc.share(x);
      const shareY = mpc.share(y);

      const shareSum = mpc.add(shareX, shareY);
      const result = mpc.open(shareSum);

      expect(result).toBe(1200n);
    });

    it('evaluates scalar multiplication gate [c * x] = c * [x]', () => {
      const x = 45n;
      const c = 12n;

      const shareX = mpc.share(x);
      const shareProduct = mpc.scalarMultiply(shareX, c);
      const result = mpc.open(shareProduct);

      expect(result).toBe(540n);
    });
  });

  describe('Beaver Multiplication Triplet Gate', () => {
    it('evaluates non-linear multiplication gate [x * y] using Beaver triplet', () => {
      const x = 12345n;
      const y = 67890n;
      const expectedProduct = (x * y) % SPDZ_PRIME;

      const shareX = mpc.share(x);
      const shareY = mpc.share(y);
      const triplet = mpc.generateBeaverTriplet('triplet_01');

      const shareXY = mpc.multiply(shareX, shareY, triplet);
      const reconstructed = mpc.open(shareXY);

      expect(reconstructed).toBe(expectedProduct);
    });
  });

  describe('Batched MAC Consistency Audit', () => {
    it('verifies batched opened wires and catches invalid wire data', () => {
      const x1 = 100n;
      const x2 = 200n;

      const s1 = mpc.share(x1);
      const s2 = mpc.share(x2);

      const batch = [
        { value: x1, macShares: s1 },
        { value: x2, macShares: s2 },
      ];

      const auditPass = mpc.batchAuditOpenedValues(batch);
      expect(auditPass.passed).toBe(true);
      expect(auditPass.checkedWiresCount).toBe(2);

      // Tampered wire
      const badBatch = [
        { value: x1, macShares: s1 },
        { value: x2 + 5n, macShares: s2 }, // Inconsistent value!
      ];
      const auditFail = mpc.batchAuditOpenedValues(badBatch);
      expect(auditFail.passed).toBe(false);
    });
  });
});
