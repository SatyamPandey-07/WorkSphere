import {
  ThresholdPedersenVSS,
  VSSFieldMath,
  VSS_PRIME,
} from '../../core/crypto/ThresholdPedersenVSS';

describe('ThresholdPedersenVSS', () => {
  let vss: ThresholdPedersenVSS;

  beforeEach(() => {
    vss = new ThresholdPedersenVSS();
  });

  describe('Field Math & Polynomial Evaluation', () => {
    it('performs modular arithmetic mod VSS_PRIME', () => {
      const a = 12345678901234567890n;
      const b = 98765432109876543210n;
      expect(VSSFieldMath.add(a, b)).toBe((a + b) % VSS_PRIME);
      expect(VSSFieldMath.sub(a, b)).toBe(((a - b) % VSS_PRIME + VSS_PRIME) % VSS_PRIME);
      expect(VSSFieldMath.mul(a, b)).toBe((a * b) % VSS_PRIME);
    });

    it('evaluates polynomials accurately', () => {
      // P(x) = 5 + 3x + 2x^2
      const coeffs = [5n, 3n, 2n];
      // P(2) = 5 + 6 + 8 = 19
      expect(vss.evaluatePolynomial(coeffs, 2n)).toBe(19n);
    });
  });

  describe('Threshold Dealing & Verifiable Secret Sharing', () => {
    it('deals verifiable shares and validates each share against commitments', () => {
      const secret = 424242n;
      const threshold = 3;
      const totalShares = 5;

      const deal = vss.deal(secret, threshold, totalShares);

      expect(deal.threshold).toBe(threshold);
      expect(deal.totalShares).toBe(totalShares);
      expect(deal.commitments.length).toBe(threshold);
      expect(deal.shares.length).toBe(totalShares);

      // Verify each share individually
      for (const share of deal.shares) {
        expect(vss.verifyShare(share, deal.commitments)).toBe(true);
      }

      // Batch verify
      expect(vss.batchVerifyShares(deal.shares, deal.commitments)).toBe(true);
    });

    it('rejects tampered shares', () => {
      const secret = 9999n;
      const deal = vss.deal(secret, 3, 5);

      const tamperedShare = {
        ...deal.shares[0],
        shareS: deal.shares[0].shareS + 1n,
      };

      expect(vss.verifyShare(tamperedShare, deal.commitments)).toBe(false);
    });

    it('reconstructs the original secret from any threshold subset of shares', () => {
      const secret = 1337420n;
      const blinding = 987654n;
      const threshold = 3;
      const totalShares = 6;

      const deal = vss.deal(secret, threshold, totalShares, blinding);

      // Subset 1: shares 0, 1, 2
      const subset1 = [deal.shares[0], deal.shares[1], deal.shares[2]];
      const res1 = vss.reconstructSecret(subset1, threshold);
      expect(res1.secret).toBe(secret);
      expect(res1.blinding).toBe(blinding);

      // Subset 2: shares 1, 3, 5
      const subset2 = [deal.shares[1], deal.shares[3], deal.shares[5]];
      const res2 = vss.reconstructSecret(subset2, threshold);
      expect(res2.secret).toBe(secret);
      expect(res2.blinding).toBe(blinding);
    });

    it('throws error if insufficient shares are provided for reconstruction', () => {
      const deal = vss.deal(100n, 3, 5);
      expect(() => {
        vss.reconstructSecret([deal.shares[0], deal.shares[1]], 3);
      }).toThrow('Insufficient shares');
    });
  });
});
