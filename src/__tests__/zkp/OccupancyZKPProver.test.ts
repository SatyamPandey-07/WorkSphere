/**
 * @file OccupancyZKPProver.test.ts
 * @description Comprehensive unit test suite for zero-knowledge room occupancy threshold prover,
 * Pedersen commitments, Fiat-Shamir non-interactive arguments, and capacity compliance verification.
 */

import {
  OccupancyZKPProver,
  ZKFieldMath,
  FiatShamirTranscript,
  SECP256K1_ORDER,
  GENERATOR_G,
  GENERATOR_H,
  type RoomCapacityThreshold,
} from '../../core/zkp/OccupancyZKPProver';

describe('OccupancyZKPProver & Zero-Knowledge Facility Compliance Engine', () => {
  let prover: OccupancyZKPProver;

  const defaultThreshold: RoomCapacityThreshold = {
    roomId: 'boardroom-402',
    minCapacity: 2,
    maxCapacity: 20,
    emergencyExitLimit: 25,
    timestamp: 1700000000000
  };

  beforeEach(() => {
    prover = new OccupancyZKPProver();
  });

  describe('ZKFieldMath', () => {
    it('performs modular arithmetic correctly modulo secp256k1 order', () => {
      const a = SECP256K1_ORDER - 10n;
      const b = 15n;
      expect(ZKFieldMath.add(a, b)).toBe(5n);
      expect(ZKFieldMath.sub(5n, 15n)).toBe(SECP256K1_ORDER - 10n);
      expect(ZKFieldMath.mul(7n, 11n)).toBe(77n);
      expect(ZKFieldMath.exp(3n, 4n)).toBe(81n);
    });

    it('computes modular multiplicative inverse via Fermat Little Theorem', () => {
      const val = 123456789n;
      const inv = ZKFieldMath.inv(val);
      expect(ZKFieldMath.mul(val, inv)).toBe(1n);
    });

    it('generates random scalars within valid field bounds', () => {
      const r1 = ZKFieldMath.randomScalar();
      const r2 = ZKFieldMath.randomScalar();
      expect(r1).toBeGreaterThan(0n);
      expect(r1).toBeLessThan(SECP256K1_ORDER);
      expect(r2).toBeGreaterThan(0n);
      expect(r2).toBeLessThan(SECP256K1_ORDER);
      expect(r1).not.toBe(r2);
    });
  });

  describe('FiatShamirTranscript', () => {
    it('produces deterministic challenges from identical transcript sequence', () => {
      const t1 = new FiatShamirTranscript();
      t1.append('room', 'conference-A');
      t1.append('val', 42n);
      const c1 = t1.challenge();

      const t2 = new FiatShamirTranscript();
      t2.append('room', 'conference-A');
      t2.append('val', 42n);
      const c2 = t2.challenge();

      expect(c1).toBe(c2);
    });

    it('produces distinct challenges when transcript inputs differ', () => {
      const t1 = new FiatShamirTranscript().append('key', 'val1');
      const t2 = new FiatShamirTranscript().append('key', 'val2');
      expect(t1.challenge()).not.toBe(t2.challenge());
    });
  });

  describe('Pedersen Commitments', () => {
    it('creates valid commitments and exhibits additive homomorphism', () => {
      const r1 = 12345n;
      const r2 = 67890n;
      const com1 = prover.commit(10, r1);
      const com2 = prover.commit(5, r2);

      // C(a) * C(b) mod order
      const combinedCommitment = ZKFieldMath.mul(com1.commitment, com2.commitment);
      
      // C(a + b, r1 + r2)
      const comSum = prover.commit(15, ZKFieldMath.add(r1, r2));
      expect(combinedCommitment).toBe(comSum.commitment);
    });

    it('rejects negative occupancy count in commit()', () => {
      expect(() => prover.commit(-3)).toThrow('Occupancy count cannot be negative');
    });
  });

  describe('Zero-Knowledge Proof Generation and Verification', () => {
    it('proves and verifies valid room occupancy within capacity limits', () => {
      const actualOccupancy = 12; // inside [2, 20]
      const proof = prover.generateProof(defaultThreshold, actualOccupancy);

      expect(proof.roomId).toBe('boardroom-402');
      expect(proof.commitment).toBeGreaterThan(0n);
      expect(proof.slackProof.bitProofs).toHaveLength(8);
      expect(proof.isEgressCompliant).toBe(true);

      const result = prover.verifyProof(proof);
      expect(result.valid).toBe(true);
      expect(result.isWithinCapacity).toBe(true);
      expect(result.isEgressCompliant).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('handles exact boundary capacity limits (n = minCapacity and n = maxCapacity)', () => {
      // Test at exact min
      const proofMin = prover.generateProof(defaultThreshold, 2);
      const resMin = prover.verifyProof(proofMin);
      expect(resMin.valid).toBe(true);

      // Test at exact max
      const proofMax = prover.generateProof(defaultThreshold, 20);
      const resMax = prover.verifyProof(proofMax);
      expect(resMax.valid).toBe(true);
    });

    it('throws error during proof generation if actual occupancy exceeds capacity', () => {
      expect(() => prover.generateProof(defaultThreshold, 25)).toThrow(
        'Actual occupancy (25) violates capacity range [2, 20]'
      );
      expect(() => prover.generateProof(defaultThreshold, 1)).toThrow(
        'Actual occupancy (1) violates capacity range [2, 20]'
      );
    });

    it('rejects forged proof when commitment is tampered', () => {
      const proof = prover.generateProof(defaultThreshold, 10);
      // Tamper with commitment
      proof.commitment = ZKFieldMath.add(proof.commitment, 1n);

      const result = prover.verifyProof(proof);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rejects forged proof when Schnorr response is altered', () => {
      const proof = prover.generateProof(defaultThreshold, 10);
      proof.proofOfKnowledge.responseN = ZKFieldMath.add(proof.proofOfKnowledge.responseN, 999n);

      const result = prover.verifyProof(proof);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Commitment knowledge opening verification failed');
    });

    it('rejects proof when Fiat-Shamir challenge is forged', () => {
      const proof = prover.generateProof(defaultThreshold, 10);
      proof.proofOfKnowledge.challenge = 123456789n;

      const result = prover.verifyProof(proof);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Fiat-Shamir challenge mismatch');
    });

    it('correctly reports egress non-compliance when limit is exceeded', () => {
      const tightThreshold: RoomCapacityThreshold = {
        roomId: 'lab-101',
        minCapacity: 1,
        maxCapacity: 15,
        emergencyExitLimit: 8,
        timestamp: 1700000000000
      };

      const proof = prover.generateProof(tightThreshold, 12);
      expect(proof.isEgressCompliant).toBe(false);

      const result = prover.verifyProof(proof);
      expect(result.valid).toBe(true);
      expect(result.isEgressCompliant).toBe(false);
    });
  });

  describe('Batch Verification & Facility Auditing', () => {
    it('batch verifies multiple room proofs and generates cryptographic audit summary', () => {
      const rooms: RoomCapacityThreshold[] = [
        { roomId: 'room-1', minCapacity: 1, maxCapacity: 10, emergencyExitLimit: 12, timestamp: 1700000000000 },
        { roomId: 'room-2', minCapacity: 5, maxCapacity: 50, emergencyExitLimit: 60, timestamp: 1700000000000 },
        { roomId: 'room-3', minCapacity: 0, maxCapacity: 4, emergencyExitLimit: 5, timestamp: 1700000000000 }
      ];

      const p1 = prover.generateProof(rooms[0], 5);
      const p2 = prover.generateProof(rooms[1], 25);
      const p3 = prover.generateProof(rooms[2], 2);

      const batch = [p1, p2, p3];
      const summary = prover.verifyBatch(batch);

      expect(summary.totalRoomsAudited).toBe(3);
      expect(summary.compliantRoomsCount).toBe(3);
      expect(summary.violationRoomsCount).toBe(0);
      expect(typeof summary.auditHash).toBe('string');
      expect(summary.auditHash).toHaveLength(64);
    });

    it('accurately tallies tampered proofs in batch verification', () => {
      const room: RoomCapacityThreshold = {
        roomId: 'auditorium',
        minCapacity: 10,
        maxCapacity: 100,
        emergencyExitLimit: 120,
        timestamp: 1700000000000
      };

      const pGood = prover.generateProof(room, 50);
      const pBad = prover.generateProof(room, 60);
      pBad.commitment = ZKFieldMath.add(pBad.commitment, 42n);

      const summary = prover.verifyBatch([pGood, pBad]);
      expect(summary.totalRoomsAudited).toBe(2);
      expect(summary.compliantRoomsCount).toBe(1);
      expect(summary.violationRoomsCount).toBe(1);
    });
  });
});
