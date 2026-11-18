import {
  createPrfSalt,
  buildPrfRegistrationExtension,
  buildPrfAuthenticationExtension,
  attachPrfToRegistrationOptions,
  attachPrfToAuthenticationOptions,
  extractPrfResultFromCredential,
  isPrfEnabledInRegistration,
  deriveAesGcmKeyFromPrf,
  encryptVaultNote,
  decryptVaultNote,
  evaluatePrfAndDeriveVaultKey,
  DEFAULT_VAULT_PRF_SALT,
} from "@/lib/auth/passkeyVaultPrf";

describe("WebAuthn PRF Extension Vault Encryption (#6508)", () => {
  const sampleNote = "Confidential desk reservation & locker passkey: #ALPHA-2814";

  describe("createPrfSalt & Extension Builders", () => {
    it("generates a 32-byte default PRF salt", () => {
      const salt = createPrfSalt();
      expect(salt).toBeInstanceOf(Uint8Array);
      expect(salt.byteLength).toBe(32);
    });

    it("generates a 32-byte salt from a custom string", () => {
      const salt = createPrfSalt("custom-salt-test-string");
      expect(salt.byteLength).toBe(32);
    });

    it("accepts a 32-byte Uint8Array salt", () => {
      const customBytes = new Uint8Array(32).fill(42);
      const salt = createPrfSalt(customBytes);
      expect(salt).toEqual(customBytes);
    });

    it("builds PRF registration extension input", () => {
      const ext = buildPrfRegistrationExtension();
      expect(ext).toEqual({ prf: {} });
    });

    it("builds PRF authentication extension with eval.first", () => {
      const ext = buildPrfAuthenticationExtension("test-salt");
      expect(ext.prf).toBeDefined();
      expect(ext.prf.eval.first).toBeInstanceOf(Uint8Array);
      expect(ext.prf.eval.first.byteLength).toBe(32);
    });

    it("attaches PRF to registration and authentication options", () => {
      const regOptions: PublicKeyCredentialCreationOptions = {
        rp: { name: "WorkSphere", id: "worksphere.test" },
        user: { id: new Uint8Array([1, 2, 3]), name: "user@test", displayName: "User" },
        challenge: new Uint8Array([4, 5, 6]),
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      };
      const regWithPrf = attachPrfToRegistrationOptions(regOptions);
      expect((regWithPrf.extensions as any)?.prf).toEqual({});

      const authOptions: PublicKeyCredentialRequestOptions = {
        challenge: new Uint8Array([7, 8, 9]),
        rpId: "worksphere.test",
      };
      const authWithPrf = attachPrfToAuthenticationOptions(authOptions);
      expect((authWithPrf.extensions as any)?.prf?.eval?.first).toBeInstanceOf(Uint8Array);
    });
  });

  describe("extractPrfResultFromCredential & isPrfEnabledInRegistration", () => {
    it("extracts PRF output from credential results", () => {
      const fakePrfBuffer = new Uint8Array(32).fill(99).buffer;
      const fakeCredential = {
        getClientExtensionResults: () => ({
          prf: {
            results: {
              first: fakePrfBuffer,
            },
          },
        }),
      } as unknown as PublicKeyCredential;

      const extracted = extractPrfResultFromCredential(fakeCredential);
      expect(extracted).toBe(fakePrfBuffer);
    });

    it("returns null if PRF results are absent", () => {
      const fakeCredential = {
        getClientExtensionResults: () => ({}),
      } as unknown as PublicKeyCredential;

      expect(extractPrfResultFromCredential(fakeCredential)).toBeNull();
    });

    it("detects PRF enabled in registration", () => {
      const fakeCredentialEnabled = {
        getClientExtensionResults: () => ({ prf: { enabled: true } }),
      } as unknown as PublicKeyCredential;

      const fakeCredentialDisabled = {
        getClientExtensionResults: () => ({ prf: { enabled: false } }),
      } as unknown as PublicKeyCredential;

      expect(isPrfEnabledInRegistration(fakeCredentialEnabled)).toBe(true);
      expect(isPrfEnabledInRegistration(fakeCredentialDisabled)).toBe(false);
    });
  });

  describe("deriveAesGcmKeyFromPrf & Vault Encryption", () => {
    it("derives a 256-bit AES-GCM key from PRF output using crypto.subtle.deriveKey", async () => {
      const fakePrfOutput = new Uint8Array(32).fill(7);
      const key = await deriveAesGcmKeyFromPrf(fakePrfOutput);

      expect(key).toBeDefined();
      expect(key.algorithm.name).toBe("AES-GCM");
      expect((key.algorithm as any).length).toBe(256);
      expect(key.usages).toContain("encrypt");
      expect(key.usages).toContain("decrypt");
    });

    it("throws if PRF output is less than 16 bytes", async () => {
      const shortBytes = new Uint8Array(8);
      await expect(deriveAesGcmKeyFromPrf(shortBytes)).rejects.toThrow(
        "PRF output must be at least 16 bytes"
      );
    });

    it("encrypts and decrypts offline notes successfully roundtrip", async () => {
      const fakePrfOutput = new Uint8Array(32).fill(15);
      const key = await deriveAesGcmKeyFromPrf(fakePrfOutput);

      const encrypted = await encryptVaultNote(sampleNote, key);
      expect(encrypted.algorithm).toBe("AES-GCM-256");
      expect(encrypted.keyDerivation).toBe("WEBAUTHN-PRF");
      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.iv).toBeDefined();

      const decrypted = await decryptVaultNote(encrypted, key);
      expect(decrypted).toBe(sampleNote);
    });

    it("fails decryption when using a different derived key", async () => {
      const prfOutput1 = new Uint8Array(32).fill(1);
      const prfOutput2 = new Uint8Array(32).fill(2);

      const key1 = await deriveAesGcmKeyFromPrf(prfOutput1);
      const key2 = await deriveAesGcmKeyFromPrf(prfOutput2);

      const encrypted = await encryptVaultNote(sampleNote, key1);
      await expect(decryptVaultNote(encrypted, key2)).rejects.toThrow();
    });
  });

  describe("evaluatePrfAndDeriveVaultKey", () => {
    it("orchestrates passkey ceremony and derives key from returned PRF output", async () => {
      const fakePrfBuffer = new Uint8Array(32).fill(24).buffer;
      const fakeCredential = {
        id: "cred-123",
        getClientExtensionResults: () => ({
          prf: {
            results: {
              first: fakePrfBuffer,
            },
          },
        }),
      };

      const originalNav = global.navigator;
      (global as any).navigator = {
        credentials: {
          get: jest.fn().mockResolvedValue(fakeCredential),
        },
      };

      const { key, credential, prfOutput } = await evaluatePrfAndDeriveVaultKey({
        challenge: new Uint8Array([1, 2, 3]),
      });

      expect(key).toBeDefined();
      expect(key.algorithm.name).toBe("AES-GCM");
      expect(credential).toBe(fakeCredential);
      expect(prfOutput).toBe(fakePrfBuffer);

      (global as any).navigator = originalNav;
    });
  });
});
