import { describe, it, expect } from 'vitest';
import {
  BN254_PRIME,
  FieldMath,
  generateMDSMatrix,
  generateRoundConstants,
  createPoseidonParams,
  PoseidonPermutation,
  poseidonHash,
  PoseidonCipher,
} from '../../core/zkp/PoseidonCipher';

describe('PoseidonCipher and Cryptographic Sponge', () => {
  describe('FieldMath', () => {
    it('performs addition and subtraction mod BN254 prime', () => {
      const a = 123456789n;
      const b = 987654321n;
      const sum = FieldMath.add(a, b);
      expect(sum).toBe(1111111110n);
      const diff = FieldMath.sub(sum, b);
      expect(diff).toBe(a);
    });

    it('performs multiplication and inverse mod BN254 prime', () => {
      const a = 0xdeadbeef12345678n;
      const invA = FieldMath.inv(a);
      const product = FieldMath.mul(a, invA);
      expect(product).toBe(1n);
    });

    it('throws error when inverting zero in field', () => {
      expect(() => FieldMath.inv(0n)).toThrow('Cannot invert zero');
    });
  });

  describe('MDS Matrix and Round Constants', () => {
    it('generates valid t x t Cauchy MDS matrix', () => {
      const mds = generateMDSMatrix(3);
      expect(mds.length).toBe(3);
      expect(mds[0].length).toBe(3);
      expect(mds[0][0] > 0n).toBe(true);
      expect(mds[0][0] < BN254_PRIME).toBe(true);
    });

    it('generates deterministic round constants of required length', () => {
      const constants = generateRoundConstants(3, 65);
      expect(constants.length).toBe(3 * 65);
      for (const c of constants) {
        expect(c >= 0n && c < BN254_PRIME).toBe(true);
      }
    });
  });

  describe('PoseidonPermutation & Hash', () => {
    it('computes deterministic Poseidon permutation', () => {
      const perm = new PoseidonPermutation(createPoseidonParams(3, 8, 57));
      const state = [1n, 2n, 3n];
      const out1 = perm.permute(state);
      const out2 = perm.permute(state);
      expect(out1.length).toBe(3);
      expect(out1[0]).toBe(out2[0]);
      expect(out1[1]).toBe(out2[1]);
      expect(out1[2]).toBe(out2[2]);
    });

    it('computes deterministic Poseidon hash with collision resistance', () => {
      const h1 = poseidonHash([100n, 200n]);
      const h2 = poseidonHash([100n, 200n]);
      const h3 = poseidonHash([100n, 201n]);

      expect(h1).toBe(h2);
      expect(h1 !== h3).toBe(true);
      expect(h1 > 0n).toBe(true);
      expect(h1 < BN254_PRIME).toBe(true);
    });

    it('throws on empty hash inputs', () => {
      expect(() => poseidonHash([])).toThrow('Input elements array cannot be empty');
    });
  });

  describe('PoseidonCipher Duplex Authenticated Encryption', () => {
    const cipher = new PoseidonCipher(4);
    const key = [0x123456789abcdef0n, 0xfedcba9876543210n];
    const nonce = 42n;

    it('encrypts and decrypts field elements payload cleanly', () => {
      const plaintext = [111n, 222n, 333n, 444n, 555n];
      const associatedData = [9999n];

      const encrypted = cipher.encrypt(key, nonce, plaintext, associatedData);
      expect(encrypted.ciphertext.length).toBe(plaintext.length);
      expect(encrypted.tag > 0n).toBe(true);

      const decrypted = cipher.decrypt(key, nonce, encrypted.ciphertext, encrypted.tag, associatedData);
      expect(decrypted).toEqual(plaintext);
    });

    it('encrypts and decrypts UTF-8 text strings', () => {
      const secretMessage = 'Zero-Knowledge Proofs for DID Authentication in WorkSphere';
      const plaintextElems = PoseidonCipher.textToFieldElements(secretMessage);
      const encrypted = cipher.encrypt(key, nonce, plaintextElems);
      const decryptedElems = cipher.decrypt(key, nonce, encrypted.ciphertext, encrypted.tag);
      const recoveredMessage = PoseidonCipher.fieldElementsToText(decryptedElems);

      expect(recoveredMessage).toBe(secretMessage);
    });

    it('rejects tampered ciphertext', () => {
      const plaintext = [10n, 20n, 30n];
      const encrypted = cipher.encrypt(key, nonce, plaintext);
      const tamperedCiphertext = [...encrypted.ciphertext];
      tamperedCiphertext[0] = FieldMath.add(tamperedCiphertext[0], 1n);

      expect(() => {
        cipher.decrypt(key, nonce, tamperedCiphertext, encrypted.tag);
      }).toThrow('Authentication tag verification failed');
    });

    it('rejects tampered authentication tag', () => {
      const plaintext = [10n, 20n, 30n];
      const encrypted = cipher.encrypt(key, nonce, plaintext);
      const tamperedTag = FieldMath.add(encrypted.tag, 1n);

      expect(() => {
        cipher.decrypt(key, nonce, encrypted.ciphertext, tamperedTag);
      }).toThrow('Authentication tag verification failed');
    });

    it('rejects mismatched associated data', () => {
      const plaintext = [10n, 20n, 30n];
      const encrypted = cipher.encrypt(key, nonce, plaintext, [100n]);

      expect(() => {
        cipher.decrypt(key, nonce, encrypted.ciphertext, encrypted.tag, [101n]);
      }).toThrow('Authentication tag verification failed');
    });

    it('rejects incorrect key', () => {
      const plaintext = [10n, 20n, 30n];
      const encrypted = cipher.encrypt(key, nonce, plaintext);
      const wrongKey = [0x999n, 0x888n];

      expect(() => {
        cipher.decrypt(wrongKey, nonce, encrypted.ciphertext, encrypted.tag);
      }).toThrow('Authentication tag verification failed');
    });
  });
});
