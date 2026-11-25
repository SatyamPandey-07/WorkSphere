import { describe, it, expect } from 'vitest';
import {
  KYBER_Q,
  KYBER_N,
  KyberField,
  KyberPoly,
  KyberCBD,
  CrystalsKyberKEM,
} from '../../core/crypto/CrystalsKyberKEM';

describe('Crystals-Kyber Post-Quantum KEM', () => {
  describe('Ring and Field Arithmetic', () => {
    it('performs addition and subtraction mod q', () => {
      const a = 2000;
      const b = 1500;
      const sum = KyberField.add(a, b);
      expect(sum).toBe((2000 + 1500) % KYBER_Q);
      const diff = KyberField.sub(sum, b);
      expect(diff).toBe(a);
    });

    it('multiplies polynomials with negacyclic reduction X^256 = -1', () => {
      // p1 = X^200, p2 = X^60 -> product = X^260 = X^4 * X^256 = -X^4 = q - 1 at index 4
      const p1 = new KyberPoly();
      p1.coeffs[200] = 1;

      const p2 = new KyberPoly();
      p2.coeffs[60] = 1;

      const prod = p1.mul(p2);
      expect(prod.coeffs[4]).toBe(KYBER_Q - 1);
    });
  });

  describe('Centered Binomial Distribution (CBD)', () => {
    it('samples centered noise within [-eta, eta] bounds', () => {
      const seed = new Uint8Array(32).fill(7);
      const poly = KyberCBD.sample(seed, 0, 2);

      expect(poly.coeffs.length).toBe(KYBER_N);
      for (let i = 0; i < KYBER_N; i++) {
        const val = poly.coeffs[i];
        // Must be in [0, 2] or [q-2, q-1]
        const isNearZero = val <= 2 || val >= KYBER_Q - 2;
        expect(isNearZero).toBe(true);
      }
    });
  });

  describe('KEM Encapsulation & Decapsulation', () => {
    const kem = new CrystalsKyberKEM('KYBER_512');

    it('generates keypair and derives matching shared secrets', () => {
      const keyPair = kem.keyGen();
      expect(keyPair.publicKey.length).toBeGreaterThan(0);
      expect(keyPair.secretKey.length).toBeGreaterThan(0);

      const enc = kem.encapsulate(keyPair.publicKey);
      expect(enc.ciphertext.length).toBeGreaterThan(0);
      expect(enc.sharedSecret.length).toBe(32);

      const decSharedSecret = kem.decapsulate(keyPair.secretKey, enc.ciphertext);
      expect(decSharedSecret.length).toBe(32);

      // Both sides establish the exact same 256-bit symmetric key!
      expect(Buffer.from(decSharedSecret).toString('hex')).toBe(
        Buffer.from(enc.sharedSecret).toString('hex')
      );
    });

    it('triggers implicit rejection on tampered ciphertext (IND-CCA2)', () => {
      const keyPair = kem.keyGen();
      const enc = kem.encapsulate(keyPair.publicKey);

      // Tamper ciphertext
      const tamperedCiphertext = new Uint8Array(enc.ciphertext);
      tamperedCiphertext[10] ^= 0xff;

      const decSharedSecret = kem.decapsulate(keyPair.secretKey, tamperedCiphertext);

      // Implicit rejection produces a pseudorandom secret distinct from authentic secret
      expect(Buffer.from(decSharedSecret).toString('hex')).not.toBe(
        Buffer.from(enc.sharedSecret).toString('hex')
      );
      expect(decSharedSecret.length).toBe(32);
    });

    it('operates across different security levels (Kyber-768)', () => {
      const kem768 = new CrystalsKyberKEM('KYBER_768');
      const kp = kem768.keyGen();
      const enc = kem768.encapsulate(kp.publicKey);
      const dec = kem768.decapsulate(kp.secretKey, enc.ciphertext);

      expect(Buffer.from(dec).toString('hex')).toBe(
        Buffer.from(enc.sharedSecret).toString('hex')
      );
    });
  });
});
