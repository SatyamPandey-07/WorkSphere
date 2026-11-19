import {
  BilinearAccumulator,
  AccumulatorFieldMath,
  ACC_PRIME,
} from '../../core/zkp/BilinearAccumulator';

describe('BilinearAccumulator', () => {
  let acc: BilinearAccumulator;

  beforeEach(() => {
    acc = new BilinearAccumulator(1337n);
  });

  describe('Field Math & Dynamic Accumulation', () => {
    it('performs modular arithmetic mod ACC_PRIME', () => {
      const a = 12345678901234567890n;
      const b = 98765432109876543210n;
      expect(AccumulatorFieldMath.add(a, b)).toBe((a + b) % ACC_PRIME);
      expect(AccumulatorFieldMath.sub(a, b)).toBe(((a - b) % ACC_PRIME + ACC_PRIME) % ACC_PRIME);
      expect(AccumulatorFieldMath.mul(a, b)).toBe((a * b) % ACC_PRIME);
    });

    it('accumulates elements dynamically and computes valid witnesses', () => {
      acc.add(10n);
      acc.add(20n);
      acc.add(30n);

      expect(acc.getElements().length).toBe(3);

      const w10 = acc.computeWitness(10n);
      const w20 = acc.computeWitness(20n);
      const w30 = acc.computeWitness(30n);

      expect(acc.verifyWitness(10n, w10)).toBe(true);
      expect(acc.verifyWitness(20n, w20)).toBe(true);
      expect(acc.verifyWitness(30n, w30)).toBe(true);

      // Verify false witness
      expect(acc.verifyWitness(10n, w20)).toBe(false);
    });

    it('updates witnesses dynamically on element addition and removal', () => {
      acc.add(100n);
      acc.add(200n);

      let w100 = acc.computeWitness(100n);
      expect(acc.verifyWitness(100n, w100)).toBe(true);

      // Add 300n
      acc.add(300n);
      w100 = acc.updateWitnessAdd(w100, 300n);
      expect(acc.verifyWitness(100n, w100)).toBe(true);

      // Remove 200n
      acc.remove(200n);
      w100 = acc.updateWitnessRemove(w100, 200n);
      expect(acc.verifyWitness(100n, w100)).toBe(true);
    });
  });

  describe('Zero-Knowledge Membership Proofs', () => {
    it('proves and verifies zero-knowledge membership argument', () => {
      acc.add(42n);
      acc.add(84n);
      const witness = acc.computeWitness(42n);

      const proof = acc.proveMembershipZKP(42n, witness);
      const verification = acc.verifyMembershipZKP(proof);
      expect(verification.valid).toBe(true);
    });

    it('rejects tampered challenge', () => {
      acc.add(99n);
      const witness = acc.computeWitness(99n);
      const proof = acc.proveMembershipZKP(99n, witness);

      const tampered = {
        ...proof,
        challenge: proof.challenge + 1n,
      };

      const res = acc.verifyMembershipZKP(tampered);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('challenge mismatch');
    });

    it('batch verifies multiple independent membership proofs', () => {
      const acc1 = new BilinearAccumulator(11n);
      acc1.add(1n);
      acc1.add(2n);
      const p1 = acc1.proveMembershipZKP(1n, acc1.computeWitness(1n));

      const acc2 = new BilinearAccumulator(22n);
      acc2.add(10n);
      acc2.add(20n);
      const p2 = acc2.proveMembershipZKP(20n, acc2.computeWitness(20n));

      const batch = acc.verifyBatch([p1, p2], [acc1.getAccumulator(), acc2.getAccumulator()]);
      expect(batch.valid).toBe(true);
      expect(batch.verifiedCount).toBe(2);
      expect(batch.errors.length).toBe(0);
    });
  });
});
