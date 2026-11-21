import {
  BulletproofsVectorFolding,
  FoldingFieldMath,
  FOLDING_PRIME,
} from '../../core/zkp/BulletproofsVectorFolding';

describe('BulletproofsVectorFolding', () => {
  let engine: BulletproofsVectorFolding;

  beforeEach(() => {
    engine = new BulletproofsVectorFolding();
  });

  describe('Field Math & Basis Generation', () => {
    it('performs modular arithmetic mod FOLDING_PRIME', () => {
      const a = 12345678901234567890n;
      const b = 98765432109876543210n;
      expect(FoldingFieldMath.add(a, b)).toBe((a + b) % FOLDING_PRIME);
      expect(FoldingFieldMath.sub(a, b)).toBe(((a - b) % FOLDING_PRIME + FOLDING_PRIME) % FOLDING_PRIME);
      expect(FoldingFieldMath.mul(a, b)).toBe((a * b) % FOLDING_PRIME);
    });

    it('generates power-of-two generator basis and computes commitment', () => {
      const basis = engine.generateBasis(4);
      expect(basis.length).toBe(4);

      const vec = [10n, 20n, 30n, 40n];
      const comm = engine.commit(vec, basis, 5n);
      expect(comm > 0n).toBe(true);

      expect(() => engine.generateBasis(6)).toThrow('must be a power of two');
    });
  });

  describe('Logarithmic Vector Commitment Folding', () => {
    it('folds 4-element vector into a single scalar in 2 rounds', () => {
      const basis = engine.generateBasis(4);
      const vec = [1n, 2n, 3n, 4n];

      const proof = engine.proveFolding(vec, basis, 42n);

      expect(proof.dimension).toBe(4);
      expect(proof.rounds.length).toBe(2); // log2(4) = 2
      expect(proof.finalScalar > 0n).toBe(true);
      expect(proof.finalGenerator > 0n).toBe(true);

      const verification = engine.verifyFolding(proof, basis);
      expect(verification.valid).toBe(true);
    });

    it('folds 8-element vector in 3 rounds', () => {
      const basis = engine.generateBasis(8);
      const vec = [10n, 20n, 30n, 40n, 50n, 60n, 70n, 80n];

      const proof = engine.proveFolding(vec, basis);

      expect(proof.dimension).toBe(8);
      expect(proof.rounds.length).toBe(3); // log2(8) = 3
      const verification = engine.verifyFolding(proof, basis);
      expect(verification.valid).toBe(true);
    });

    it('rejects tampered folding proofs', () => {
      const basis = engine.generateBasis(4);
      const vec = [1n, 1n, 1n, 1n];

      const proof = engine.proveFolding(vec, basis);

      const tamperedProof = {
        ...proof,
        rounds: [
          { ...proof.rounds[0], challenge: proof.rounds[0].challenge + 1n },
          proof.rounds[1],
        ],
      };

      const res = engine.verifyFolding(tamperedProof, basis);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('Fiat-Shamir challenge mismatch');
    });
  });
});
