import {
  ThresholdVerifiableEncryption,
  TVEFieldMath,
  TVE_PRIME,
} from '../../core/crypto/ThresholdVerifiableEncryption';

describe('ThresholdVerifiableEncryption', () => {
  let tve: ThresholdVerifiableEncryption;

  beforeEach(() => {
    tve = new ThresholdVerifiableEncryption();
  });

  describe('Field Math & Verifiable Encryption Proofs', () => {
    it('performs modular arithmetic mod TVE_PRIME', () => {
      const a = 12345678901234567890n;
      const b = 98765432109876543210n;
      expect(TVEFieldMath.add(a, b)).toBe((a + b) % TVE_PRIME);
      expect(TVEFieldMath.sub(a, b)).toBe(((a - b) % TVE_PRIME + TVE_PRIME) % TVE_PRIME);
      expect(TVEFieldMath.mul(a, b)).toBe((a * b) % TVE_PRIME);
    });

    it('encrypts secret and verifies DLEQ zero-knowledge proof', () => {
      const thresholdSK = 54321n;
      const thresholdPK = TVEFieldMath.mul(thresholdSK, tve.g, TVE_PRIME);
      const secret = 99999n;

      const { ciphertext, proof, publicCommitment } = tve.encryptAndProve(secret, thresholdPK);

      expect(ciphertext.c1).toBeDefined();
      expect(ciphertext.c2).toBeDefined();

      const isValid = tve.verifyEncryption(ciphertext, publicCommitment, thresholdPK, proof);
      expect(isValid).toBe(true);
    });

    it('rejects tampered ciphertexts or proofs', () => {
      const thresholdPK = TVEFieldMath.mul(12345n, tve.g, TVE_PRIME);
      const { ciphertext, proof, publicCommitment } = tve.encryptAndProve(42n, thresholdPK);

      const tamperedCT = { ...ciphertext, c2: ciphertext.c2 + 1n };
      expect(tve.verifyEncryption(tamperedCT, publicCommitment, thresholdPK, proof)).toBe(false);

      const tamperedProof = { ...proof, challenge: proof.challenge + 1n };
      expect(tve.verifyEncryption(ciphertext, publicCommitment, thresholdPK, tamperedProof)).toBe(false);
    });
  });

  describe('Threshold Decryption with Verifiable Decryption Shares', () => {
    it('verifies decryption shares and reconstructs original commitment', () => {
      // 2-of-3 polynomial: y(x) = y0 + a1 * x
      const y0 = 7777n;
      const a1 = 1111n;
      const thresholdPK = TVEFieldMath.mul(y0, tve.g, TVE_PRIME);

      // Node shares at x = 1, 2, 3
      const share1 = (y0 + a1 * 1n) % TVE_PRIME;
      const share2 = (y0 + a1 * 2n) % TVE_PRIME;
      const share3 = (y0 + a1 * 3n) % TVE_PRIME;

      const secret = 123456n;
      const { ciphertext, publicCommitment } = tve.encryptAndProve(secret, thresholdPK);

      // Node 1 & 2 produce partial decryption shares
      const decShare1 = tve.partialDecrypt(ciphertext, share1, 1);
      const decShare2 = tve.partialDecrypt(ciphertext, share2, 2);

      const pubShare1 = TVEFieldMath.mul(share1, tve.g, TVE_PRIME);
      const pubShare2 = TVEFieldMath.mul(share2, tve.g, TVE_PRIME);

      expect(tve.verifyDecryptionShare(decShare1, ciphertext, pubShare1)).toBe(true);
      expect(tve.verifyDecryptionShare(decShare2, ciphertext, pubShare2)).toBe(true);

      // Combine shares
      const decryptedP = tve.combineDecryption(ciphertext, [decShare1, decShare2], 2);
      expect(decryptedP).toBe(publicCommitment);
    });
  });
});
