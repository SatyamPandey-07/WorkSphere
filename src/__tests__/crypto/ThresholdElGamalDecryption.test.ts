import {
  ThresholdElGamalDecryption,
  ThresholdFieldMath,
  THRESHOLD_PRIME,
} from '../../core/crypto/ThresholdElGamalDecryption';

describe('ThresholdElGamalDecryption', () => {
  const threshold = 3;
  const totalParties = 5;
  let scheme: ThresholdElGamalDecryption;

  beforeEach(() => {
    scheme = new ThresholdElGamalDecryption(threshold, totalParties);
  });

  describe('Field Math & Key Generation', () => {
    it('performs modular arithmetic operations modulo THRESHOLD_PRIME', () => {
      const a = 12345678901234567890n;
      const b = 98765432109876543210n;
      expect(ThresholdFieldMath.add(a, b)).toBe((a + b) % THRESHOLD_PRIME);
      expect(ThresholdFieldMath.sub(a, b)).toBe(((a - b) % THRESHOLD_PRIME + THRESHOLD_PRIME) % THRESHOLD_PRIME);
      expect(ThresholdFieldMath.mul(a, b)).toBe((a * b) % THRESHOLD_PRIME);
    });

    it('generates threshold key shares and public keys', () => {
      const { masterPublicKey, shares } = scheme.generateThresholdKeys();
      expect(masterPublicKey > 0n).toBe(true);
      expect(shares.length).toBe(totalParties);
      expect(shares[0].publicShare > 0n).toBe(true);
    });
  });

  describe('Threshold Decryption & Chaum-Pedersen Verification', () => {
    it('encrypts, produces verifiable shares, and reconstructs plaintext with t shares', () => {
      const { shares } = scheme.generateThresholdKeys();
      const message = 7777777n;
      const ct = scheme.encrypt(message);

      const publicSharesMap = new Map<number, bigint>();
      for (const s of shares) {
        publicSharesMap.set(s.partyIndex, s.publicShare);
      }

      // Generate decryption shares for parties 1, 2, 4 (any 3 of 5)
      const selectedIndices = [1, 2, 4];
      const decShares = selectedIndices.map(idx => scheme.computeDecryptionShare(idx, ct));

      // Verify each individual decryption share
      for (let i = 0; i < decShares.length; i++) {
        const pk = publicSharesMap.get(selectedIndices[i])!;
        const ver = scheme.verifyDecryptionShare(decShares[i], ct, pk);
        expect(ver.valid).toBe(true);
      }

      // Reconstruct message using Lagrange interpolation
      const recovered = scheme.combineDecryptionShares(decShares, ct, publicSharesMap);
      expect(recovered).toBe(message);
    });

    it('rejects tampered decryption shares', () => {
      const { shares } = scheme.generateThresholdKeys();
      const ct = scheme.encrypt(42n);

      const share = scheme.computeDecryptionShare(1, ct);
      const pk = shares[0].publicShare;

      // Tamper with partial decryption
      const tamperedShare = {
        ...share,
        partialDecryption: share.partialDecryption + 1n,
      };

      const ver = scheme.verifyDecryptionShare(tamperedShare, ct, pk);
      expect(ver.valid).toBe(false);
    });

    it('throws if insufficient shares provided', () => {
      const { shares } = scheme.generateThresholdKeys();
      const ct = scheme.encrypt(42n);

      const publicSharesMap = new Map<number, bigint>();
      shares.forEach(s => publicSharesMap.set(s.partyIndex, s.publicShare));

      // Only 2 shares provided (threshold is 3)
      const decShares = [scheme.computeDecryptionShare(1, ct), scheme.computeDecryptionShare(2, ct)];
      expect(() => scheme.combineDecryptionShares(decShares, ct, publicSharesMap)).toThrow('Insufficient shares');
    });
  });
});
