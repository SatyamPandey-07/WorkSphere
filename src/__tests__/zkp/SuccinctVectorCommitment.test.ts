import {
  SuccinctVectorCommitment,
  SVCFieldMath,
  SVC_PRIME,
} from '../../core/zkp/SuccinctVectorCommitment';

describe('SuccinctVectorCommitment', () => {
  let svc: SuccinctVectorCommitment;

  beforeEach(() => {
    svc = new SuccinctVectorCommitment();
  });

  describe('Field Math & Vector Commitment', () => {
    it('performs modular arithmetic mod SVC_PRIME', () => {
      const a = 12345678901234567890n;
      const b = 98765432109876543210n;
      expect(SVCFieldMath.add(a, b)).toBe((a + b) % SVC_PRIME);
      expect(SVCFieldMath.sub(a, b)).toBe(((a - b) % SVC_PRIME + SVC_PRIME) % SVC_PRIME);
      expect(SVCFieldMath.mul(a, b)).toBe((a * b) % SVC_PRIME);
    });

    it('commits to vector and verifies single coordinate openings', () => {
      const n = 4;
      const basis = svc.generateBasis(n);
      const vector = [10n, 20n, 30n, 40n];

      const commitment = svc.commit(vector, basis);
      expect(commitment).toBeGreaterThan(0n);

      for (let i = 0; i < n; i++) {
        const witness = svc.openIndex(vector, i, basis);
        const isValid = svc.verifyOpening(commitment, vector[i], i, witness, basis);
        expect(isValid).toBe(true);
      }
    });

    it('rejects falsified opening value', () => {
      const n = 3;
      const basis = svc.generateBasis(n);
      const vector = [5n, 15n, 25n];
      const commitment = svc.commit(vector, basis);
      const witness = svc.openIndex(vector, 1, basis);

      expect(svc.verifyOpening(commitment, 999n, 1, witness, basis)).toBe(false);
    });
  });

  describe('Subvector Openings & Dynamic Updates', () => {
    it('generates and verifies arbitrary subvector openings', () => {
      const n = 5;
      const basis = svc.generateBasis(n);
      const vector = [100n, 200n, 300n, 400n, 500n];
      const commitment = svc.commit(vector, basis);

      // Open subvector at indices [1, 3] (values 200n and 400n)
      const indices = [1, 3];
      const witness = svc.openSubvector(vector, indices, basis);

      const elements = [
        { index: 1, value: 200n },
        { index: 3, value: 400n },
      ];

      expect(svc.verifySubvector(commitment, elements, witness, basis)).toBe(true);
    });

    it('updates commitment and witnesses in O(1) upon coordinate modification', () => {
      const n = 4;
      const basis = svc.generateBasis(n);
      const vector = [10n, 20n, 30n, 40n];
      const oldCommitment = svc.commit(vector, basis);

      // Opening for coordinate 0
      const oldWitness0 = svc.openIndex(vector, 0, basis);
      expect(svc.verifyOpening(oldCommitment, 10n, 0, oldWitness0, basis)).toBe(true);

      // Modify index 2 from 30n to 99n
      const newCommitment = svc.updateCommitment(oldCommitment, 2, 30n, 99n, basis);

      // Witness for index 0 updated in O(1)
      const newWitness0 = svc.updateWitness(oldWitness0, 0, 2, 30n, 99n, basis);

      // Verify that index 0 is valid against newCommitment using updated witness!
      expect(svc.verifyOpening(newCommitment, 10n, 0, newWitness0, basis)).toBe(true);
    });

    it('batch verifies multiple subvector openings', () => {
      const n = 4;
      const basis = svc.generateBasis(n);
      const v1 = [1n, 2n, 3n, 4n];
      const v2 = [10n, 20n, 30n, 40n];

      const c1 = svc.commit(v1, basis);
      const c2 = svc.commit(v2, basis);

      const w1 = svc.openSubvector(v1, [0, 2], basis);
      const w2 = svc.openSubvector(v2, [1, 3], basis);

      const sub1 = [{ index: 0, value: 1n }, { index: 2, value: 3n }];
      const sub2 = [{ index: 1, value: 20n }, { index: 3, value: 40n }];

      const isBatchValid = svc.batchVerify([c1, c2], [sub1, sub2], [w1, w2], basis);
      expect(isBatchValid).toBe(true);
    });
  });
});
