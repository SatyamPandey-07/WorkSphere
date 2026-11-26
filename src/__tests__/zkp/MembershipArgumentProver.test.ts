import {
  MembershipArgumentProver,
  MemberFieldMath,
  MEMBERSHIP_PRIME,
} from '../../core/zkp/MembershipArgumentProver';

describe('MembershipArgumentProver', () => {
  let prover: MembershipArgumentProver;

  beforeEach(() => {
    prover = new MembershipArgumentProver();
  });

  describe('Field Math & Polynomial Set Product', () => {
    it('performs finite field arithmetic mod MEMBERSHIP_PRIME', () => {
      const a = 12345678901234567890n;
      const b = 98765432109876543210n;
      expect(MemberFieldMath.add(a, b)).toBe((a + b) % MEMBERSHIP_PRIME);
      expect(MemberFieldMath.sub(a, b)).toBe(((a - b) % MEMBERSHIP_PRIME + MEMBERSHIP_PRIME) % MEMBERSHIP_PRIME);
      expect(MemberFieldMath.mul(a, b)).toBe((a * b) % MEMBERSHIP_PRIME);
    });

    it('computes set product vanishing on membership', () => {
      const set = [10n, 20n, 30n, 40n];
      // Element in set vanishes
      expect(prover.computeSetProduct(20n, set)).toBe(0n);
      // Element not in set does not vanish
      expect(prover.computeSetProduct(25n, set)).not.toBe(0n);
    });
  });

  describe('Zero-Knowledge Membership Proving & Verification', () => {
    it('proves and verifies membership of an element in a set', () => {
      const set = [101n, 202n, 303n, 404n, 505n];
      const witness = 303n;

      const proof = prover.proveMembership(witness, set);
      expect(proof.setSize).toBe(5);
      expect(proof.challenge > 0n).toBe(true);

      const verification = prover.verifyMembership(proof, set);
      expect(verification.valid).toBe(true);
    });

    it('rejects proving for non-member elements', () => {
      const set = [1n, 2n, 3n];
      expect(() => prover.proveMembership(99n, set)).toThrow('Witness is not a member');
    });

    it('rejects tampered proofs with modified challenges or sets', () => {
      const set = [10n, 20n, 30n];
      const proof = prover.proveMembership(20n, set);

      // Verify with modified set
      const tamperedSet = [10n, 20n, 35n];
      const res1 = prover.verifyMembership(proof, tamperedSet);
      expect(res1.valid).toBe(false);
      expect(res1.reason).toContain('Fiat-Shamir challenge mismatch');

      // Verify with tampered challenge
      const forgedProof = { ...proof, challenge: proof.challenge + 1n };
      const res2 = prover.verifyMembership(forgedProof, set);
      expect(res2.valid).toBe(false);
    });
  });

  describe('Batch Multi-Proof Verification', () => {
    it('verifies a batch of independent membership proofs', () => {
      const set1 = [1n, 2n, 3n];
      const set2 = [100n, 200n, 300n, 400n];

      const p1 = prover.proveMembership(2n, set1);
      const p2 = prover.proveMembership(400n, set2);

      const batchRes = prover.verifyBatch([p1, p2], [set1, set2]);
      expect(batchRes.valid).toBe(true);
      expect(batchRes.verifiedCount).toBe(2);
      expect(batchRes.errors.length).toBe(0);
    });
  });
});
