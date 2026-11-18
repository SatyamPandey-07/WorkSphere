import {
  LookupArgumentProver,
  LookupFieldMath,
  LOOKUP_PRIME,
} from '../../core/zkp/LookupArgumentProver';

describe('LookupArgumentProver', () => {
  let prover: LookupArgumentProver;

  beforeEach(() => {
    prover = new LookupArgumentProver();
  });

  describe('Field Math & Merged Multiset Sorting', () => {
    it('performs modular arithmetic mod LOOKUP_PRIME', () => {
      const a = 12345678901234567890n;
      const b = 98765432109876543210n;
      expect(LookupFieldMath.add(a, b)).toBe((a + b) % LOOKUP_PRIME);
      expect(LookupFieldMath.sub(a, b)).toBe(((a - b) % LOOKUP_PRIME + LOOKUP_PRIME) % LOOKUP_PRIME);
      expect(LookupFieldMath.mul(a, b)).toBe((a * b) % LOOKUP_PRIME);
    });

    it('merges and sorts witness and table into combined multiset', () => {
      const f = [30n, 10n];
      const t = [10n, 20n, 30n, 40n];
      const s = prover.sortMergedMultiset(f, t);
      expect(s).toEqual([10n, 10n, 20n, 30n, 30n, 40n]);
    });
  });

  describe('Zero-Knowledge Lookup Proof Generation & Verification', () => {
    it('proves and verifies table lookup for valid witness subset', () => {
      const t = [10n, 20n, 30n, 40n, 50n];
      const f = [20n, 40n, 10n]; // Valid subset of t

      const { proof, tableCommitment } = prover.proveLookup(f, t, 42n);

      expect(proof.witnessLength).toBe(3);
      expect(proof.tableLength).toBe(5);
      expect(proof.beta > 0n).toBe(true);
      expect(proof.gamma > 0n).toBe(true);

      const verification = prover.verifyLookup(tableCommitment, proof);
      expect(verification.valid).toBe(true);
    });

    it('rejects witness containing elements outside table', () => {
      const t = [1n, 2n, 3n];
      const f = [2n, 99n]; // 99 not in t

      expect(() => prover.proveLookup(f, t)).toThrow('Lookup witness element 99 is not present in table');
    });

    it('rejects tampered lookup proofs', () => {
      const t = [5n, 10n, 15n];
      const f = [5n, 15n];

      const { proof, tableCommitment } = prover.proveLookup(f, t);

      const tamperedProof = {
        ...proof,
        beta: proof.beta + 1n,
      };

      const res = prover.verifyLookup(tableCommitment, tamperedProof);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('Fiat-Shamir challenge mismatch');
    });
  });
});
