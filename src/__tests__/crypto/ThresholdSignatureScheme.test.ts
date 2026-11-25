/**
 * @file ThresholdSignatureScheme.test.ts
 * @description Comprehensive unit tests for ScalarField arithmetic, Shamir Secret Sharing,
 * Lagrange polynomial interpolation, FROST two-round signing, and signature aggregation.
 */

import {
  FrostCoordinator,
  ScalarField,
  SECP256K1_ORDER,
  ShamirSecretSharing,
} from '../../core/crypto/ThresholdSignatureScheme';

describe('ThresholdSignatureScheme & FROST Protocol', () => {
  describe('ScalarField Finite Field Arithmetic', () => {
    it('performs modular addition, subtraction, and multiplication', () => {
      const a = SECP256K1_ORDER - 5n;
      const b = 10n;
      expect(ScalarField.add(a, b)).toBe(5n);
      expect(ScalarField.sub(5n, 10n)).toBe(SECP256K1_ORDER - 5n);
      expect(ScalarField.mul(2n, 3n)).toBe(6n);
    });

    it('computes modular inverse satisfying a * a^-1 = 1 mod n', () => {
      const a = 9876543210123456789n;
      const invA = ScalarField.inv(a);
      expect(ScalarField.mul(a, invA)).toBe(1n);
    });

    it('generates non-zero random scalars within field bounds', () => {
      const s1 = ScalarField.randomScalar();
      const s2 = ScalarField.randomScalar();
      expect(s1).toBeGreaterThan(0n);
      expect(s1).toBeLessThan(SECP256K1_ORDER);
      expect(s1).not.toBe(s2);
    });
  });

  describe('ShamirSecretSharing & Lagrange Interpolation', () => {
    it('splits a secret into 5 shares with threshold 3 and reconstructs accurately', () => {
      const masterSecret = 1234567890987654321n;
      const { shares } = ShamirSecretSharing.splitSecret(masterSecret, 3, 5);

      expect(shares).toHaveLength(5);

      // Reconstruct with any 3 shares: (shares[0], shares[1], shares[2])
      const reconstructed1 = ShamirSecretSharing.reconstructSecret([shares[0], shares[1], shares[2]]);
      expect(reconstructed1).toBe(masterSecret);

      // Reconstruct with different 3 shares: (shares[1], shares[3], shares[4])
      const reconstructed2 = ShamirSecretSharing.reconstructSecret([shares[1], shares[3], shares[4]]);
      expect(reconstructed2).toBe(masterSecret);
    });
  });

  describe('FROST Two-Round Signing & Verification', () => {
    it('produces a valid Schnorr threshold signature from t participants', () => {
      const masterSecret = 424242424242n;
      const threshold = 3;
      const total = 5;
      const { shares, groupPublicKey } = ShamirSecretSharing.splitSecret(masterSecret, threshold, total);

      const coordinator = new FrostCoordinator(threshold, total, shares, groupPublicKey);
      const message = 'workspace-escrow-release-tx-001';

      // Pick t=3 participants: 1, 2, 4
      const selectedIds = [1, 2, 4];
      const noncePairs = selectedIds.map((id) => coordinator.generateNoncePair(id));
      const commitments = noncePairs.map((np) => np.commitment);

      // Round 2: Each participant generates signature share
      const signatureShares = noncePairs.map((np) =>
        coordinator.signShare(np.participantId, np, message, commitments)
      );

      // Individual share verification
      for (let i = 0; i < signatureShares.length; i++) {
        const validShare = coordinator.verifyShare(
          signatureShares[i],
          commitments[i],
          message,
          commitments
        );
        expect(validShare).toBe(true);
      }

      // Aggregate into group Schnorr signature
      const finalSig = coordinator.aggregateSignatures(message, commitments, signatureShares);
      expect(finalSig.rCommitment).toBeGreaterThan(0n);
      expect(finalSig.zScalar).toBeGreaterThan(0n);

      // Group Schnorr signature verification
      const isValid = coordinator.verifySignature(finalSig, message);
      expect(isValid).toBe(true);

      // Verify tampered message fails
      expect(coordinator.verifySignature(finalSig, 'tampered-message')).toBe(false);
    });

    it('detects and rejects corrupted signature shares', () => {
      const masterSecret = 999999999n;
      const threshold = 2;
      const total = 3;
      const { shares, groupPublicKey } = ShamirSecretSharing.splitSecret(masterSecret, threshold, total);

      const coordinator = new FrostCoordinator(threshold, total, shares, groupPublicKey);
      const message = 'tx-proposal';

      const noncePairs = [1, 2].map((id) => coordinator.generateNoncePair(id));
      const commitments = noncePairs.map((np) => np.commitment);

      const signatureShares = noncePairs.map((np) =>
        coordinator.signShare(np.participantId, np, message, commitments)
      );

      // Corrupt participant 2's share
      signatureShares[1].share = ScalarField.add(signatureShares[1].share, 100n);

      expect(() =>
        coordinator.aggregateSignatures(message, commitments, signatureShares)
      ).toThrow('Invalid signature share detected from participant 2');
    });
  });
});
