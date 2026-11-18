import { describe, it, expect, beforeEach } from 'vitest';
import {
  ZKCredentialAccumulator,
  DEFAULT_ACCUMULATOR_MODULUS,
  DEFAULT_ACCUMULATOR_GENERATOR,
} from '../../core/zkp/ZKCredentialAccumulator';

describe('ZKCredentialAccumulator - Cryptographic Accumulator & ZK Proofs', () => {
  let accumulator: ZKCredentialAccumulator;

  beforeEach(() => {
    accumulator = new ZKCredentialAccumulator();
  });

  describe('Deterministic Prime Mapping', () => {
    it('deterministically hashes credential ID to unique prime representative', () => {
      const p1 = accumulator.hashToPrime('cred_vip_pass_001');
      const p2 = accumulator.hashToPrime('cred_vip_pass_001');
      const p3 = accumulator.hashToPrime('cred_vip_pass_002');

      expect(p1).toBe(p2);
      expect(p1).not.toBe(p3);
      expect(p1 % 2n).not.toBe(0n); // Odd
    });
  });

  describe('Accumulator State & Witness Verification', () => {
    it('accumulates credentials and generates valid O(1) membership witnesses', () => {
      const cred1 = 'cred_executive_boardroom_pass';
      const cred2 = 'cred_biometric_hardware_lab';
      const cred3 = 'cred_quiet_pod_access';

      accumulator.add(cred1, 'executive');
      accumulator.add(cred2, 'security');
      accumulator.add(cred3, 'hotdesk');

      expect(accumulator.size).toBe(3);

      // Generate witness for cred1
      const witness1 = accumulator.generateWitness(cred1);
      expect(witness1.credentialId).toBe(cred1);
      expect(accumulator.verifyWitness(witness1)).toBe(true);

      // Generate witness for cred2
      const witness2 = accumulator.generateWitness(cred2);
      expect(accumulator.verifyWitness(witness2)).toBe(true);

      // Tampered witness should fail
      const tamperedWitness = {
        ...witness1,
        witnessValue: witness1.witnessValue + 1n,
      };
      expect(accumulator.verifyWitness(tamperedWitness)).toBe(false);
    });
  });

  describe('Zero-Knowledge Membership Proof (PoK of Witness)', () => {
    it('generates and verifies non-interactive ZK proof without disclosing credential ID', () => {
      const credId = 'cred_quantum_computing_vault';
      accumulator.add(credId, 'top_secret');
      accumulator.add('cred_general_hallway_access', 'public');

      const proof = accumulator.proveMembershipZK(credId, 'WorkSphereVaultVerification');
      expect(proof.isValid).toBe(true);
      expect(proof.accumulatorValue).toBe(accumulator.accumulatorValue.toString(16));

      // Verifier verifies without knowing credId
      const isVerified = accumulator.verifyMembershipZK(proof, 'WorkSphereVaultVerification');
      expect(isVerified).toBe(true);

      // Verification fails with wrong context tag
      const isWrongContext = accumulator.verifyMembershipZK(proof, 'DifferentContextTag');
      expect(isWrongContext).toBe(false);
    });
  });

  describe('Dynamic Revocation & Non-Membership', () => {
    it('revokes credential, updates state, and invalidates old witness', () => {
      const credA = 'cred_contractor_badge_01';
      const credB = 'cred_contractor_badge_02';

      accumulator.add(credA);
      accumulator.add(credB);

      const witnessA = accumulator.generateWitness(credA);
      expect(accumulator.verifyWitness(witnessA)).toBe(true);

      // Revoke credA
      const revoked = accumulator.revoke(credA);
      expect(revoked).toBe(true);
      expect(accumulator.size).toBe(1);

      // Old witness for credA now fails against updated accumulator
      expect(accumulator.verifyWitness(witnessA)).toBe(false);

      // Remaining credB witness recomputed and valid
      const witnessB = accumulator.generateWitness(credB);
      expect(accumulator.verifyWitness(witnessB)).toBe(true);
    });

    it('generates and verifies non-membership proof for unaccumulated credential', () => {
      accumulator.add('cred_permanent_resident');
      accumulator.add('cred_visitor_guest');

      const nonMemberId = 'cred_rogue_intruder_key';
      const nonMemberProof = accumulator.generateNonMembershipProof(nonMemberId);

      expect(nonMemberProof.credentialId).toBe(nonMemberId);
      expect(accumulator.verifyNonMembershipProof(nonMemberProof)).toBe(true);
    });
  });
});
