import crypto from "crypto";
import {
  deriveKeyFromPrf,
  deriveKeyFromPassphrase,
  encryptNote,
  decryptNote,
  isEncryptedNotePayload,
  parseEncryptedNote,
  type EncryptedNotePayload,
} from "@/lib/crypto/prfVault";
import {
  buildPrfAuthenticationExtension,
  createPrfSalt,
  DEFAULT_PRF_SALT_STRING,
} from "@/lib/passkey";

describe("WebAuthn PRF Vault & Note Encryption (#3450)", () => {
  const sampleNote = "Secret wifi password: Winter@2026 & Desk Code: #4092";

  describe("WebAuthn PRF Extension Options Builder", () => {
    it("should generate 32-byte salt and correct PRF extension structure", () => {
      const ext = buildPrfAuthenticationExtension();
      expect(ext.prf).toBeDefined();
      expect(ext.prf.eval.first).toBeInstanceOf(Uint8Array);
      expect(ext.prf.eval.first.length).toBe(32);
    });

    it("should accept custom salt string or Uint8Array", () => {
      const customString = "custom-salt-test";
      const ext = buildPrfAuthenticationExtension(customString);
      expect(ext.prf.eval.first.length).toBe(32);

      const customBytes = new Uint8Array(32).fill(7);
      const extBytes = buildPrfAuthenticationExtension(customBytes);
      expect(extBytes.prf.eval.first).toEqual(customBytes);
    });
  });

  describe("Key Derivation (HKDF-SHA256 from PRF output)", () => {
    it("should derive a 256-bit (32 bytes) key deterministically with the same PRF output and salt", () => {
      const fakePrfOutput = crypto.randomBytes(32);
      const salt = crypto.randomBytes(32);

      const res1 = deriveKeyFromPrf(fakePrfOutput, salt);
      const res2 = deriveKeyFromPrf(fakePrfOutput, salt);

      expect(res1.key.length).toBe(32);
      expect(res1.key).toEqual(res2.key);
      expect(res1.salt).toEqual(res2.salt);
    });

    it("should derive different keys for different PRF outputs or salts", () => {
      const prfOutput1 = crypto.randomBytes(32);
      const prfOutput2 = crypto.randomBytes(32);
      const salt = crypto.randomBytes(32);

      const key1 = deriveKeyFromPrf(prfOutput1, salt).key;
      const key2 = deriveKeyFromPrf(prfOutput2, salt).key;

      expect(key1).not.toEqual(key2);
    });

    it("should throw an error if PRF output is less than 16 bytes", () => {
      expect(() => deriveKeyFromPrf(Buffer.from("too-short"))).toThrow(
        "PRF output must be at least 16 bytes",
      );
    });
  });

  describe("Fallback Key Derivation (PBKDF2-SHA256)", () => {
    it("should derive a 256-bit key from user passphrase and salt", () => {
      const passphrase = "correct-horse-battery-staple";
      const salt = crypto.randomBytes(32);

      const res = deriveKeyFromPassphrase(passphrase, salt);
      expect(res.key.length).toBe(32);
      expect(res.salt).toEqual(salt);

      const res2 = deriveKeyFromPassphrase(passphrase, salt);
      expect(res.key).toEqual(res2.key);
    });

    it("should reject passphrases under 6 characters", () => {
      expect(() => deriveKeyFromPassphrase("12345")).toThrow(
        "Passphrase must be at least 6 characters",
      );
    });
  });

  describe("AES-GCM-256 Encryption & Decryption Roundtrip", () => {
    it("should successfully encrypt and decrypt private notes using PRF derived key", () => {
      const prfOutput = crypto.randomBytes(32);
      const { key, salt } = deriveKeyFromPrf(prfOutput);

      const payload = encryptNote(sampleNote, key, salt, "WEBAUTHN-PRF");

      expect(payload.algorithm).toBe("AES-GCM-256");
      expect(payload.keyDerivation).toBe("WEBAUTHN-PRF");
      expect(payload.ciphertext).toBeDefined();
      expect(payload.iv).toBeDefined();
      expect(payload.authTag).toBeDefined();
      expect(Buffer.from(payload.iv, "base64").length).toBe(12); // 96-bit IV
      expect(Buffer.from(payload.authTag, "base64").length).toBe(16); // 128-bit tag

      const decrypted = decryptNote(payload, key);
      expect(decrypted).toBe(sampleNote);
    });

    it("should encrypt and decrypt using fallback PBKDF2 derived key", () => {
      const passphrase = "my-secure-vault-passphrase";
      const { key, salt } = deriveKeyFromPassphrase(passphrase);

      const payload = encryptNote(sampleNote, key, salt, "PBKDF2-FALLBACK");
      expect(payload.keyDerivation).toBe("PBKDF2-FALLBACK");

      const decrypted = decryptNote(payload, key);
      expect(decrypted).toBe(sampleNote);
    });

    it("should produce different ciphertexts and IVs for the same plaintext (IV freshness)", () => {
      const prfOutput = crypto.randomBytes(32);
      const { key, salt } = deriveKeyFromPrf(prfOutput);

      const enc1 = encryptNote(sampleNote, key, salt);
      const enc2 = encryptNote(sampleNote, key, salt);

      expect(enc1.iv).not.toEqual(enc2.iv);
      expect(enc1.ciphertext).not.toEqual(enc2.ciphertext);
      expect(decryptNote(enc1, key)).toBe(sampleNote);
      expect(decryptNote(enc2, key)).toBe(sampleNote);
    });
  });

  describe("Tamper Detection (Zero-Knowledge Integrity)", () => {
    it("should reject decryption when ciphertext is tampered with", () => {
      const prfOutput = crypto.randomBytes(32);
      const { key, salt } = deriveKeyFromPrf(prfOutput);

      const payload = encryptNote(sampleNote, key, salt);

      // Flip byte in ciphertext
      const rawCipher = Buffer.from(payload.ciphertext, "base64");
      rawCipher[0] ^= 0xff;
      const tamperedPayload: EncryptedNotePayload = {
        ...payload,
        ciphertext: rawCipher.toString("base64"),
      };

      expect(() => decryptNote(tamperedPayload, key)).toThrow(/tamper detected|Decryption failed/i);
    });

    it("should reject decryption when authTag is corrupted", () => {
      const prfOutput = crypto.randomBytes(32);
      const { key, salt } = deriveKeyFromPrf(prfOutput);

      const payload = encryptNote(sampleNote, key, salt);

      const rawTag = Buffer.from(payload.authTag, "base64");
      rawTag[0] ^= 0x01;
      const tamperedPayload: EncryptedNotePayload = {
        ...payload,
        authTag: rawTag.toString("base64"),
      };

      expect(() => decryptNote(tamperedPayload, key)).toThrow(/tamper detected|Decryption failed/i);
    });

    it("should fail decryption when wrong key is provided", () => {
      const prfOutput1 = crypto.randomBytes(32);
      const prfOutput2 = crypto.randomBytes(32);
      const { key: key1, salt } = deriveKeyFromPrf(prfOutput1);
      const { key: key2 } = deriveKeyFromPrf(prfOutput2);

      const payload = encryptNote(sampleNote, key1, salt);
      expect(() => decryptNote(payload, key2)).toThrow(/tamper detected|Decryption failed/i);
    });
  });

  describe("Payload Validation & Deserialization", () => {
    it("should correctly identify and parse serialized encrypted note payload", () => {
      const prfOutput = crypto.randomBytes(32);
      const { key, salt } = deriveKeyFromPrf(prfOutput);
      const payload = encryptNote(sampleNote, key, salt);

      const serialized = JSON.stringify(payload);
      expect(isEncryptedNotePayload(payload)).toBe(true);

      const parsed = parseEncryptedNote(serialized);
      expect(parsed).not.toBeNull();
      expect(parsed?.ciphertext).toBe(payload.ciphertext);
      expect(parseEncryptedNote("plain unencrypted string")).toBeNull();
    });
  });
});
