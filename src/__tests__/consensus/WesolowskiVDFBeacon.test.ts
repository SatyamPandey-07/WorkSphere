import { describe, it, expect, beforeEach } from 'vitest';
import { WesolowskiVDFBeacon } from '../../core/consensus/WesolowskiVDFBeacon';

describe('WesolowskiVDFBeacon - Verifiable Delay Function & Random Beacon', () => {
  let vdf: WesolowskiVDFBeacon;

  beforeEach(() => {
    vdf = new WesolowskiVDFBeacon(100); // 100 sequential squarings for agile testing
  });

  describe('Sequential Evaluation & Cryptographic Verification', () => {
    it('evaluates VDF time-lock and produces verifiable Wesolowski proof', () => {
      const seed = 'lottery_block_seed_tokyo_venue_401';
      const result = vdf.evaluate(seed);

      expect(result.iterationsT).toBe(100);
      expect(result.outputY).toMatch(/^[0-9a-f]+$/);
      expect(result.proofPi).toMatch(/^[0-9a-f]+$/);
      expect(result.beaconRandomness).toMatch(/^[0-9a-f]{64}$/);

      // Verify proof in O(log l)
      const isValid = vdf.verify(result);
      expect(isValid).toBe(true);
    });

    it('rejects tampered VDF output y', () => {
      const result = vdf.evaluate('seed_alpha');
      const badResult = {
        ...result,
        outputY: result.outputY.slice(0, -2) + '00', // Tampered output!
      };

      expect(vdf.verify(badResult)).toBe(false);
    });

    it('rejects tampered Wesolowski proof pi', () => {
      const result = vdf.evaluate('seed_beta');
      const badProof = {
        ...result,
        proofPi: result.proofPi.slice(0, -2) + 'ff', // Tampered proof!
      };

      expect(vdf.verify(badProof)).toBe(false);
    });
  });

  describe('Deterministic Randomness Beacon', () => {
    it('generates reproducible, unbiasable beacon output from same seed', () => {
      const res1 = vdf.evaluate('seed_identical_quorum');
      const res2 = vdf.evaluate('seed_identical_quorum');

      expect(res1.beaconRandomness).toBe(res2.beaconRandomness);
      expect(res1.outputY).toBe(res2.outputY);
      expect(res1.proofPi).toBe(res2.proofPi);
    });

    it('produces distinct entropy beacon for differing seeds', () => {
      const resA = vdf.evaluate('seed_stream_A');
      const resB = vdf.evaluate('seed_stream_B');

      expect(resA.beaconRandomness).not.toBe(resB.beaconRandomness);
    });
  });
});
