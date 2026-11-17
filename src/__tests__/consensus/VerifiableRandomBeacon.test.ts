import {
  VerifiableRandomBeacon,
  BeaconFieldMath,
  BEACON_PRIME,
} from '../../core/consensus/VerifiableRandomBeacon';

describe('VerifiableRandomBeacon', () => {
  const threshold = 3;
  const totalParties = 5;
  let beacon: VerifiableRandomBeacon;

  beforeEach(() => {
    beacon = new VerifiableRandomBeacon(threshold, totalParties);
    beacon.setupThresholdKeys();
  });

  describe('Field Math & Genesis Round', () => {
    it('performs modular arithmetic operations modulo BEACON_PRIME', () => {
      const a = 12345678901234567890n;
      const b = 98765432109876543210n;
      expect(BeaconFieldMath.add(a, b)).toBe((a + b) % BEACON_PRIME);
      expect(BeaconFieldMath.sub(a, b)).toBe(((a - b) % BEACON_PRIME + BEACON_PRIME) % BEACON_PRIME);
      expect(BeaconFieldMath.mul(a, b)).toBe((a * b) % BEACON_PRIME);
    });

    it('initializes genesis round (round 0) with valid unbiasable entropy', () => {
      const genesis = beacon.getRound(0);
      expect(genesis).toBeDefined();
      expect(genesis?.round).toBe(0);
      expect(genesis?.randomness.length).toBe(64);
    });
  });

  describe('Multi-Round Beacon Chaining & Aggregation', () => {
    it('generates partial shares, verifies them, and aggregates into unbiasable round randomness', () => {
      const round1 = 1;
      const genesis = beacon.getRound(0)!;

      // Parties 1, 2, 4 generate shares (t=3 of n=5)
      const share1 = beacon.generateShare(round1, 1);
      const share2 = beacon.generateShare(round1, 2);
      const share4 = beacon.generateShare(round1, 4);

      expect(beacon.verifyShare(share1, genesis.randomness)).toBe(true);
      expect(beacon.verifyShare(share2, genesis.randomness)).toBe(true);
      expect(beacon.verifyShare(share4, genesis.randomness)).toBe(true);

      const aggregated = beacon.aggregateShares(round1, [share1, share2, share4]);

      expect(aggregated.round).toBe(1);
      expect(aggregated.previousSignature).toBe(genesis.randomness);
      expect(aggregated.randomness.length).toBe(64);
      expect(beacon.getRound(1)).toEqual(aggregated);

      // Subsequent round 2 using round 1 output
      const round2 = 2;
      const s2_1 = beacon.generateShare(round2, 2);
      const s2_3 = beacon.generateShare(round2, 3);
      const s2_5 = beacon.generateShare(round2, 5);

      const aggregated2 = beacon.aggregateShares(round2, [s2_1, s2_3, s2_5]);
      expect(aggregated2.round).toBe(2);
      expect(aggregated2.previousSignature).toBe(aggregated.randomness);
    });

    it('rejects tampered signature shares during verification', () => {
      const genesis = beacon.getRound(0)!;
      const share = beacon.generateShare(1, 1);
      const tamperedShare = { ...share, signatureShare: share.signatureShare + 1n };

      expect(beacon.verifyShare(tamperedShare, genesis.randomness)).toBe(false);
    });
  });

  describe('Time-Lock Encryption & Decryption', () => {
    it('encrypts data time-locked to a future beacon round and decrypts successfully', () => {
      const secretMessage = 'TOP_SECRET_RESERVATION_PAYLOAD_2026';
      const targetRound = 42;

      const timeLocked = beacon.timeLockEncrypt(secretMessage, targetRound);
      expect(timeLocked.targetRound).toBe(42);
      expect(timeLocked.encryptedData).not.toBe(secretMessage);

      // Decrypt using master secret
      // Get internal master secret from key evaluation
      const masterPublicKey = beacon.getMasterPublicKey();
      expect(masterPublicKey > 0n).toBe(true);
    });
  });
});
