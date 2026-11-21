import {
  MultiScalarExpArgument,
  MSMFieldMath,
  MSM_PRIME,
} from '../../core/zkp/MultiScalarExpArgument';

describe('MultiScalarExpArgument', () => {
  let prover: MultiScalarExpArgument;

  beforeEach(() => {
    prover = new MultiScalarExpArgument();
  });

  describe('Field Math & MSM Computation', () => {
    it('performs modular arithmetic mod MSM_PRIME', () => {
      const a = 12345678901234567890n;
      const b = 98765432109876543210n;
      expect(MSMFieldMath.add(a, b)).toBe((a + b) % MSM_PRIME);
      expect(MSMFieldMath.sub(a, b)).toBe(((a - b) % MSM_PRIME + MSM_PRIME) % MSM_PRIME);
      expect(MSMFieldMath.mul(a, b)).toBe((a * b) % MSM_PRIME);
    });

    it('computes correct multi-scalar exponentiation Y = Prod(G_i^s_i)', () => {
      const basis = prover.generateBasis(3);
      const scalars = [2n, 3n, 4n];
      // Expected = G0^2 * G1^3 * G2^4
      const expected = MSMFieldMath.mul(
        MSMFieldMath.mul(MSMFieldMath.exp(basis[0], 2n), MSMFieldMath.exp(basis[1], 3n)),
        MSMFieldMath.exp(basis[2], 4n)
      );
      const computed = prover.msm(scalars, basis);
      expect(computed).toBe(expected);
    });
  });

  describe('Succinct MSM Proving & Verification', () => {
    it('proves and verifies honest MSM computation', () => {
      const n = 4;
      const basis = prover.generateBasis(n);
      const scalars = [5n, 10n, 15n, 20n];

      const { proof, Y } = prover.proveMSM(scalars, basis, 42n);

      expect(proof.dimension).toBe(4);
      expect(proof.responses.length).toBe(4);
      expect(proof.resultY).toBe(Y);

      const verification = prover.verifyMSM(proof, basis);
      expect(verification.valid).toBe(true);
    });

    it('rejects tampered proofs', () => {
      const basis = prover.generateBasis(2);
      const scalars = [3n, 7n];

      const { proof } = prover.proveMSM(scalars, basis);

      const tamperedProof = {
        ...proof,
        challenge: proof.challenge + 1n,
      };

      const res = prover.verifyMSM(tamperedProof, basis);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('challenge mismatch');
    });
  });

  describe('Batch Multi-Proof Verification', () => {
    it('verifies a batch of independent MSM proofs', () => {
      const b1 = prover.generateBasis(2);
      const b2 = prover.generateBasis(3);

      const { proof: p1 } = prover.proveMSM([1n, 2n], b1);
      const { proof: p2 } = prover.proveMSM([3n, 4n, 5n], b2);

      const batchRes = prover.verifyBatch([p1, p2], [b1, b2]);
      expect(batchRes.valid).toBe(true);
      expect(batchRes.verifiedCount).toBe(2);
      expect(batchRes.errors.length).toBe(0);
    });
  });
});
