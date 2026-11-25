import {
  HomomorphicCiphertextComparator,
  HCCFieldMath,
  HCC_PRIME,
} from '../../core/crypto/HomomorphicCiphertextComparator';

describe('HomomorphicCiphertextComparator', () => {
  let comparator: HomomorphicCiphertextComparator;

  beforeEach(() => {
    comparator = new HomomorphicCiphertextComparator();
  });

  describe('Field Math & Homomorphic Operations', () => {
    it('performs modular arithmetic mod HCC_PRIME', () => {
      const a = 12345678901234567890n;
      const b = 98765432109876543210n;
      expect(HCCFieldMath.add(a, b)).toBe((a + b) % HCC_PRIME);
      expect(HCCFieldMath.sub(a, b)).toBe(((a - b) % HCC_PRIME + HCC_PRIME) % HCC_PRIME);
      expect(HCCFieldMath.mul(a, b)).toBe((a * b) % HCC_PRIME);
    });

    it('computes homomorphic difference between two ciphertexts', () => {
      const pk = HCCFieldMath.mul(42n, comparator.g, HCC_PRIME);
      const c1 = comparator.encrypt(100n, pk, 5n).ciphertext;
      const c2 = comparator.encrypt(40n, pk, 2n).ciphertext;

      const diff = comparator.computeDifference(c1, c2);
      // Expected diff plaintext = 60n, diff randomness = 3n
      const expectedDiff = comparator.encrypt(60n, pk, 3n).ciphertext;

      expect(diff.c1).toBe(expectedDiff.c1);
      expect(diff.c2).toBe(expectedDiff.c2);
    });
  });

  describe('Zero-Knowledge Equality Proofs', () => {
    it('proves and verifies that two ciphertexts encrypt identical plaintexts', () => {
      const pk = HCCFieldMath.mul(12345n, comparator.g, HCC_PRIME);
      const x = 777n;
      const { ciphertext: c1, r: r1 } = comparator.encrypt(x, pk);
      const { ciphertext: c2, r: r2 } = comparator.encrypt(x, pk);

      const proof = comparator.proveEquality(r1, r2, pk, c1, c2);
      const isValid = comparator.verifyEquality(c1, c2, pk, proof);
      expect(isValid).toBe(true);
    });

    it('rejects equality proof when plaintexts differ', () => {
      const pk = HCCFieldMath.mul(12345n, comparator.g, HCC_PRIME);
      const { ciphertext: c1, r: r1 } = comparator.encrypt(100n, pk);
      const { ciphertext: c2, r: r2 } = comparator.encrypt(200n, pk);

      const proof = comparator.proveEquality(r1, r2, pk, c1, c2);
      const isValid = comparator.verifyEquality(c1, c2, pk, proof);
      expect(isValid).toBe(false);
    });
  });

  describe('Zero-Knowledge Greater-Than-Or-Equal Range Proofs', () => {
    it('proves and verifies that x1 >= x2 without decrypting', () => {
      const pk = HCCFieldMath.mul(9876n, comparator.g, HCC_PRIME);
      const x1 = 250n;
      const x2 = 100n;
      const r1 = 11n;
      const r2 = 7n;

      const c1 = comparator.encrypt(x1, pk, r1).ciphertext;
      const c2 = comparator.encrypt(x2, pk, r2).ciphertext;

      const proof = comparator.proveGreaterThanOrEqual(x1, r1, x2, r2, 8, pk); // 250 - 100 = 150 < 256 (8 bits)
      const res = comparator.verifyGreaterThanOrEqual(c1, c2, proof);
      expect(res.valid).toBe(true);
    });

    it('throws error when attempting to prove x1 >= x2 when x1 < x2', () => {
      const pk = HCCFieldMath.mul(9876n, comparator.g, HCC_PRIME);
      expect(() => {
        comparator.proveGreaterThanOrEqual(50n, 1n, 100n, 2n, 8, pk);
      }).toThrow('Cannot prove x1 >= x2');
    });
  });
});
