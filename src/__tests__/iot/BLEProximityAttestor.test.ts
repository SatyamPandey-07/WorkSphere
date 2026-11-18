/**
 * @file BLEProximityAttestor.test.ts
 * @description Unit tests for Zero-Knowledge BLE Beacon Proximity Attestation Coordinator,
 * logarithmic path loss propagation, ephemeral rotating commitments, anti-replay nullifiers, and quorum verification.
 */

import {
  BLEFieldMath,
  BLEPropagation,
  EphemeralBeacon,
  BLEProximityAttestor,
  BeaconConfig,
  SECP256K1_ORDER,
  GENERATOR_G,
  GENERATOR_H,
} from '../../core/iot/BLEProximityAttestor';

describe('BLEProximityAttestor & ZK Proximity Suite', () => {
  const testBeacon: BeaconConfig = {
    id: 'beacon-desk-402',
    secretKey: 'top-secret-beacon-hardware-key-402',
    txPower: -59, // -59 dBm at 1m
    pathLossExponent: 2.0,
  };

  describe('BLEFieldMath', () => {
    it('performs modular addition, subtraction, multiplication and inversion', () => {
      const a = SECP256K1_ORDER - 10n;
      const b = 15n;
      expect(BLEFieldMath.add(a, b)).toBe(5n);
      expect(BLEFieldMath.sub(5n, 15n)).toBe(SECP256K1_ORDER - 10n);

      const val = 123456789n;
      const inv = BLEFieldMath.inv(val);
      expect(BLEFieldMath.mul(val, inv)).toBe(1n);
    });

    it('generates deterministic hash-to-scalar', () => {
      const h1 = BLEFieldMath.hashToScalar('test', 123, 456n);
      const h2 = BLEFieldMath.hashToScalar('test', 123, 456n);
      const h3 = BLEFieldMath.hashToScalar('different');
      expect(h1).toBe(h2);
      expect(h1).not.toBe(h3);
    });

    it('generates random scalars within valid range', () => {
      const s = BLEFieldMath.randomScalar();
      expect(s).toBeGreaterThan(0n);
      expect(s).toBeLessThan(SECP256K1_ORDER);
    });
  });

  describe('BLEPropagation', () => {
    it('calculates distance at 1 meter accurately', () => {
      // RSSI == TxPower should be exactly 1.0m
      const dist = BLEPropagation.calculateDistance(-59, -59, 2.0);
      expect(dist).toBeCloseTo(1.0, 1);
    });

    it('calculates closer proximity when RSSI is stronger than TxPower', () => {
      // RSSI -53 dBm > -59 dBm -> distance < 1m
      const dist = BLEPropagation.calculateDistance(-53, -59, 2.0);
      expect(dist).toBeLessThan(1.0);
      expect(dist).toBeGreaterThan(0.4);
    });

    it('calculates further proximity when RSSI is weaker than TxPower', () => {
      // RSSI -65 dBm < -59 dBm -> distance ~2m
      const dist = BLEPropagation.calculateDistance(-65, -59, 2.0);
      expect(dist).toBeGreaterThan(1.8);
      expect(dist).toBeLessThan(2.2);
    });

    it('converts to and from scaled integer millimeter units', () => {
      const scaled = BLEPropagation.toScaledUnits(1.543);
      expect(scaled).toBe(1543);
      expect(BLEPropagation.fromScaledUnits(scaled)).toBe(1.543);
    });
  });

  describe('EphemeralBeacon', () => {
    it('generates valid broadcast and verifies matching nonce', () => {
      const now = Date.now();
      const broadcast = EphemeralBeacon.generateBroadcast(testBeacon, -58, now);

      expect(broadcast.beaconId).toBe(testBeacon.id);
      expect(broadcast.epoch).toBe(EphemeralBeacon.getEpoch(now));
      expect(broadcast.nonce.length).toBe(64);

      const isValid = EphemeralBeacon.verifyBroadcast(testBeacon, broadcast, now);
      expect(isValid).toBe(true);
    });

    it('rejects broadcast with tampered nonce or mismatched ID', () => {
      const now = Date.now();
      const broadcast = EphemeralBeacon.generateBroadcast(testBeacon, -58, now);

      const tampered = { ...broadcast, nonce: '0'.repeat(64) };
      expect(EphemeralBeacon.verifyBroadcast(testBeacon, tampered, now)).toBe(false);

      const wrongId = { ...broadcast, beaconId: 'beacon-other' };
      expect(EphemeralBeacon.verifyBroadcast(testBeacon, wrongId, now)).toBe(false);
    });

    it('rejects broadcast from an expired epoch outside drift window', () => {
      const pastTime = Date.now() - 300 * 1000; // 5 minutes ago
      const broadcast = EphemeralBeacon.generateBroadcast(testBeacon, -58, pastTime);

      const isCurrent = EphemeralBeacon.verifyBroadcast(testBeacon, broadcast, Date.now(), 1);
      expect(isCurrent).toBe(false);
    });
  });

  describe('BLEProximityAttestor Zero-Knowledge Verification', () => {
    it('creates and verifies a valid zero-knowledge proximity proof within threshold', () => {
      const attestor = new BLEProximityAttestor();
      const now = Date.now();

      // Broadcast at -60 dBm (~1.12m from desk)
      const broadcast = EphemeralBeacon.generateBroadcast(testBeacon, -60, now);

      // Prove distance is within 2.0 meters
      const proof = attestor.createProximityProof(broadcast, testBeacon, 2.0);

      expect(proof.beaconId).toBe(testBeacon.id);
      expect(proof.commitment).toBeGreaterThan(0n);
      expect(proof.challenge).toBeGreaterThan(0n);
      expect(proof.thresholdScaled).toBe(2000);

      const result = attestor.verifyProximityProof(proof, testBeacon, now);
      expect(result.valid).toBe(true);
      expect(result.beaconId).toBe(testBeacon.id);
    });

    it('rejects proof creation when client is physically beyond threshold', () => {
      const attestor = new BLEProximityAttestor();
      const now = Date.now();

      // Broadcast at -85 dBm (~20m away)
      const broadcast = EphemeralBeacon.generateBroadcast(testBeacon, -85, now);

      // Attempt to prove proximity within 1.5m should throw error
      expect(() => {
        attestor.createProximityProof(broadcast, testBeacon, 1.5);
      }).toThrow(/exceeds maximum allowable threshold/);
    });

    it('detects and prevents replay attacks via nullifier registry', () => {
      const attestor = new BLEProximityAttestor();
      const now = Date.now();

      const broadcast = EphemeralBeacon.generateBroadcast(testBeacon, -58, now);
      const proof = attestor.createProximityProof(broadcast, testBeacon, 2.0);

      // First verification succeeds and registers nullifier
      const first = attestor.verifyProximityProof(proof, testBeacon, now);
      expect(first.valid).toBe(true);
      expect(attestor.getNullifierCount()).toBe(1);

      // Second verification of identical proof fails as replay
      const replay = attestor.verifyProximityProof(proof, testBeacon, now);
      expect(replay.valid).toBe(false);
      expect(replay.error).toContain('Replay attack');
    });

    it('rejects proof if cryptographic challenge is corrupted', () => {
      const attestor = new BLEProximityAttestor();
      const now = Date.now();

      const broadcast = EphemeralBeacon.generateBroadcast(testBeacon, -58, now);
      const proof = attestor.createProximityProof(broadcast, testBeacon, 2.0);

      const tamperedProof = {
        ...proof,
        challenge: BLEFieldMath.add(proof.challenge, 1n),
      };

      const result = attestor.verifyProximityProof(tamperedProof, testBeacon, now);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('challenge verification failed');
    });

    it('verifies multi-beacon quorum attestation (2-of-3)', () => {
      const attestor = new BLEProximityAttestor();
      const now = Date.now();

      const beaconA: BeaconConfig = { id: 'beacon-A', secretKey: 'keyA', txPower: -59 };
      const beaconB: BeaconConfig = { id: 'beacon-B', secretKey: 'keyB', txPower: -59 };
      const beaconC: BeaconConfig = { id: 'beacon-C', secretKey: 'keyC', txPower: -59 };

      const configs = new Map<string, BeaconConfig>([
        ['beacon-A', beaconA],
        ['beacon-B', beaconB],
        ['beacon-C', beaconC],
      ]);

      const bCastA = EphemeralBeacon.generateBroadcast(beaconA, -58, now);
      const bCastB = EphemeralBeacon.generateBroadcast(beaconB, -60, now);

      const proofA = attestor.createProximityProof(bCastA, beaconA, 2.0);
      const proofB = attestor.createProximityProof(bCastB, beaconB, 2.0);

      const quorumRes = attestor.verifyQuorum([proofA, proofB], configs, 2, now);
      expect(quorumRes.authorized).toBe(true);
      expect(quorumRes.quorumCount).toBe(2);
      expect(quorumRes.verifiedBeacons).toContain('beacon-A');
      expect(quorumRes.verifiedBeacons).toContain('beacon-B');
    });

    it('rejects multi-beacon quorum when quorum count is insufficient', () => {
      const attestor = new BLEProximityAttestor();
      const now = Date.now();

      const beaconA: BeaconConfig = { id: 'beacon-A', secretKey: 'keyA', txPower: -59 };
      const configs = new Map<string, BeaconConfig>([['beacon-A', beaconA]]);

      const bCastA = EphemeralBeacon.generateBroadcast(beaconA, -58, now);
      const proofA = attestor.createProximityProof(bCastA, beaconA, 2.0);

      // Requires 2 beacons, but only 1 provided
      const quorumRes = attestor.verifyQuorum([proofA], configs, 2, now);
      expect(quorumRes.authorized).toBe(false);
      expect(quorumRes.quorumCount).toBe(1);
    });
  });
});
