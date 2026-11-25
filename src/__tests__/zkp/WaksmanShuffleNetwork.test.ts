import {
  WaksmanShuffleNetwork,
  WaksmanFieldMath,
  WAKSMAN_PRIME,
} from '../../core/zkp/WaksmanShuffleNetwork';

describe('WaksmanShuffleNetwork', () => {
  let network: WaksmanShuffleNetwork;

  beforeEach(() => {
    network = new WaksmanShuffleNetwork();
  });

  describe('Field Math & 2x2 Switch Gates', () => {
    it('performs modular arithmetic mod WAKSMAN_PRIME', () => {
      const a = 12345678901234567890n;
      const b = 98765432109876543210n;
      expect(WaksmanFieldMath.add(a, b)).toBe((a + b) % WAKSMAN_PRIME);
      expect(WaksmanFieldMath.sub(a, b)).toBe(((a - b) % WAKSMAN_PRIME + WAKSMAN_PRIME) % WAKSMAN_PRIME);
      expect(WaksmanFieldMath.mul(a, b)).toBe((a * b) % WAKSMAN_PRIME);
    });

    it('evaluates 2x2 conditional switch gates correctly', () => {
      const in0 = 100n;
      const in1 = 200n;

      // Pass-through when s = 0
      expect(network.evaluateSwitch(in0, in1, 0)).toEqual([100n, 200n]);
      // Swap when s = 1
      expect(network.evaluateSwitch(in0, in1, 1)).toEqual([200n, 100n]);
    });
  });

  describe('Arbitrary Permutation Routing & Proving', () => {
    it('routes inputs and generates verifiable zero-knowledge shuffle proof', () => {
      const inputs = [10n, 20n, 30n, 40n];
      const permutation = [3, 0, 1, 2];

      const { proof, outputs } = network.proveShuffle(inputs, permutation, 42n);

      expect(outputs).toEqual([20n, 30n, 40n, 10n]);
      expect(proof.dimension).toBe(4);
      expect(proof.challenge > 0n).toBe(true);

      const verification = network.verifyShuffle(proof);
      expect(verification.valid).toBe(true);
    });

    it('rejects invalid permutations with duplicated or out-of-bounds indices', () => {
      const inputs = [1n, 2n, 3n];
      expect(() => network.route(inputs, [0, 0, 1])).toThrow('Invalid permutation');
      expect(() => network.route(inputs, [0, 1])).toThrow('Permutation length 2 must match input length 3');
    });

    it('rejects tampered proofs', () => {
      const inputs = [1n, 2n];
      const { proof } = network.proveShuffle(inputs, [1, 0]);

      const tamperedProof = {
        ...proof,
        challenge: proof.challenge + 1n,
      };

      const res = network.verifyShuffle(tamperedProof);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('Fiat-Shamir challenge mismatch');
    });
  });
});
