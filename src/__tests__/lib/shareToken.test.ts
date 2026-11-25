import crypto from "crypto";
import {
  encryptShareToken,
  decryptShareToken,
  CLOCK_SKEW_TOLERANCE_MS,
  ShareTokenPayload,
} from "@/lib/shareToken";
import { ENCRYPTION_KEY } from "@/lib/crypto";

describe("shareToken", () => {
  const originalEnvKey = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    jest.useRealTimers();
  });

  afterEach(() => {
    process.env.ENCRYPTION_KEY = originalEnvKey;
  });

  // Helper to craft custom tokens (valid AES-GCM or corrupted)
  function createCustomToken(
    payloadObj: unknown,
    options?: {
      key?: Buffer;
      iv?: Buffer;
      authTagModifier?: (tag: Buffer) => Buffer;
      ciphertextModifier?: (cipher: string) => string;
    },
  ): string {
    const key = options?.key ?? ENCRYPTION_KEY;
    const iv = options?.iv ?? crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

    const payloadStr =
      typeof payloadObj === "string" ? payloadObj : JSON.stringify(payloadObj);
    let encrypted = cipher.update(payloadStr, "utf8", "base64url");
    encrypted += cipher.final("base64url");

    if (options?.ciphertextModifier) {
      encrypted = options.ciphertextModifier(encrypted);
    }

    let authTag = cipher.getAuthTag();
    if (options?.authTagModifier) {
      authTag = options.authTagModifier(authTag);
    }

    const ivStr = iv.toString("base64url");
    const authTagStr = authTag.toString("base64url");

    return `${ivStr}.${encrypted}.${authTagStr}`;
  }

  describe("Valid Token Encryption and Decryption", () => {
    it("encrypts and decrypts a valid collection share token", () => {
      const issuedAt = 1_700_000_000_000;
      const payload: ShareTokenPayload = {
        collectionId: "col_12345",
        permission: "view",
        issuedAt,
      };

      const token = encryptShareToken(payload);
      expect(typeof token).toBe("string");
      expect(token.split(".")).toHaveLength(3);

      const decrypted = decryptShareToken(token);
      expect(decrypted).not.toBeNull();
      expect(decrypted).toEqual(payload);
      expect(decrypted?.collectionId).toBe("col_12345");
      expect(decrypted?.permission).toBe("view");
      expect(decrypted?.issuedAt).toBe(issuedAt);
    });

    it("generates different tokens for identical payloads due to random IV", () => {
      const payload: ShareTokenPayload = {
        collectionId: "col_abc",
        permission: "view",
        issuedAt: 1_700_000_000_000,
      };

      const token1 = encryptShareToken(payload);
      const token2 = encryptShareToken(payload);

      expect(token1).not.toBe(token2);
      expect(decryptShareToken(token1)).toEqual(payload);
      expect(decryptShareToken(token2)).toEqual(payload);
    });

    it("decrypts successfully without an optional TTL parameter (backward compatibility)", () => {
      const ancientTime = 1_000_000_000_000; // Far in the past
      const token = encryptShareToken({
        collectionId: "col_ancient",
        permission: "view",
        issuedAt: ancientTime,
      });

      // When maxAgeMs is omitted, it should never reject based on age
      const decrypted = decryptShareToken(token);
      expect(decrypted).toEqual({
        collectionId: "col_ancient",
        permission: "view",
        issuedAt: ancientTime,
      });
    });
  });

  describe("Expiration Validation with maxAgeMs", () => {
    const fixedNow = 1_700_000_000_000;
    const maxAge = 60 * 60 * 1000; // 1 hour

    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(fixedNow);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("accepts token within its TTL", () => {
      const token = encryptShareToken({
        collectionId: "col_valid_ttl",
        permission: "view",
        issuedAt: fixedNow - 30 * 60 * 1000, // 30 minutes old
      });

      const decrypted = decryptShareToken(token, maxAge);
      expect(decrypted).not.toBeNull();
      expect(decrypted?.collectionId).toBe("col_valid_ttl");
    });

    it("accepts newly issued token (age = 0)", () => {
      const token = encryptShareToken({
        collectionId: "col_fresh",
        permission: "view",
        issuedAt: fixedNow,
      });

      const decrypted = decryptShareToken(token, maxAge);
      expect(decrypted).not.toBeNull();
      expect(decrypted?.collectionId).toBe("col_fresh");
    });

    it("accepts token exactly at the expiration boundary (age === maxAgeMs)", () => {
      const token = encryptShareToken({
        collectionId: "col_boundary",
        permission: "view",
        issuedAt: fixedNow - maxAge, // exactly 1 hour old
      });

      const decrypted = decryptShareToken(token, maxAge);
      expect(decrypted).not.toBeNull();
      expect(decrypted?.collectionId).toBe("col_boundary");
    });

    it("rejects token just beyond the expiration boundary (age === maxAgeMs + 1)", () => {
      const token = encryptShareToken({
        collectionId: "col_just_expired",
        permission: "view",
        issuedAt: fixedNow - maxAge - 1, // 1 ms past expiration
      });

      const decrypted = decryptShareToken(token, maxAge);
      expect(decrypted).toBeNull();
    });

    it("rejects significantly expired token", () => {
      const token = encryptShareToken({
        collectionId: "col_old",
        permission: "view",
        issuedAt: fixedNow - 24 * 60 * 60 * 1000, // 24 hours old
      });

      const decrypted = decryptShareToken(token, maxAge);
      expect(decrypted).toBeNull();
    });

    it("allows expired token when maxAgeMs is undefined (preserves legacy behavior)", () => {
      const token = encryptShareToken({
        collectionId: "col_legacy",
        permission: "view",
        issuedAt: fixedNow - 24 * 60 * 60 * 1000, // 24 hours old
      });

      // With TTL -> null
      expect(decryptShareToken(token, maxAge)).toBeNull();
      // Without TTL -> valid payload
      expect(decryptShareToken(token)).not.toBeNull();
      expect(decryptShareToken(token)?.collectionId).toBe("col_legacy");
    });
  });

  describe("Future Timestamp and Clock Skew Handling", () => {
    const fixedNow = 1_700_000_000_000;
    const maxAge = 60 * 60 * 1000;

    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(fixedNow);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("accepts issuedAt slightly in future within clock skew tolerance", () => {
      const token = encryptShareToken({
        collectionId: "col_future_ok",
        permission: "view",
        issuedAt: fixedNow + 30_000, // +30s in future
      });

      const decrypted = decryptShareToken(token, maxAge);
      expect(decrypted).not.toBeNull();
      expect(decrypted?.collectionId).toBe("col_future_ok");
    });

    it("accepts issuedAt exactly at the clock skew tolerance boundary", () => {
      const token = encryptShareToken({
        collectionId: "col_future_exact",
        permission: "view",
        issuedAt: fixedNow + CLOCK_SKEW_TOLERANCE_MS,
      });

      const decrypted = decryptShareToken(token, maxAge);
      expect(decrypted).not.toBeNull();
      expect(decrypted?.collectionId).toBe("col_future_exact");
    });

    it("rejects issuedAt just beyond clock skew tolerance (+1 ms)", () => {
      const token = encryptShareToken({
        collectionId: "col_future_exceeded",
        permission: "view",
        issuedAt: fixedNow + CLOCK_SKEW_TOLERANCE_MS + 1,
      });

      const decrypted = decryptShareToken(token, maxAge);
      expect(decrypted).toBeNull();
    });

    it("rejects significantly future-dated tokens", () => {
      const token = encryptShareToken({
        collectionId: "col_future_far",
        permission: "view",
        issuedAt: fixedNow + 24 * 60 * 60 * 1000,
      });

      const decrypted = decryptShareToken(token, maxAge);
      expect(decrypted).toBeNull();
    });
  });

  describe("Invalid TTL Parameter Validation", () => {
    const validToken = encryptShareToken({
      collectionId: "col_ttl_test",
      permission: "view",
      issuedAt: Date.now(),
    });

    it("rejects non-positive TTL (zero)", () => {
      expect(decryptShareToken(validToken, 0)).toBeNull();
    });

    it("rejects negative TTL", () => {
      expect(decryptShareToken(validToken, -1000)).toBeNull();
    });

    it("rejects NaN TTL", () => {
      expect(decryptShareToken(validToken, NaN)).toBeNull();
    });

    it("rejects Infinity and -Infinity TTL", () => {
      expect(decryptShareToken(validToken, Infinity)).toBeNull();
      expect(decryptShareToken(validToken, -Infinity)).toBeNull();
    });

    it("rejects non-number TTL values passed via any/runtime casting", () => {
      // @ts-expect-error Testing runtime invalid input
      expect(decryptShareToken(validToken, "60000")).toBeNull();
      // @ts-expect-error Testing runtime invalid input
      expect(decryptShareToken(validToken, {})).toBeNull();
      // @ts-expect-error Testing runtime invalid input
      expect(decryptShareToken(validToken, null)).toBeNull();
    });
  });

  describe("Malformed Tokens and Token Structure", () => {
    it("returns null for non-string token inputs", () => {
      // @ts-expect-error Testing runtime invalid input
      expect(decryptShareToken(null)).toBeNull();
      // @ts-expect-error Testing runtime invalid input
      expect(decryptShareToken(undefined)).toBeNull();
      // @ts-expect-error Testing runtime invalid input
      expect(decryptShareToken(12345)).toBeNull();
      // @ts-expect-error Testing runtime invalid input
      expect(decryptShareToken({})).toBeNull();
    });

    it("returns null for empty token string", () => {
      expect(decryptShareToken("")).toBeNull();
    });

    it("returns null for random non-token string", () => {
      expect(decryptShareToken("invalid-random-token-string")).toBeNull();
    });

    it("returns null when token does not have exactly 3 parts", () => {
      expect(decryptShareToken("part1.part2")).toBeNull();
      expect(decryptShareToken("part1.part2.part3.part4")).toBeNull();
      expect(decryptShareToken(".")).toBeNull();
      expect(decryptShareToken("..")).toBeNull();
    });

    it("returns null when token segments are empty strings", () => {
      expect(decryptShareToken("..part3")).toBeNull();
      expect(decryptShareToken("part1..part3")).toBeNull();
      expect(decryptShareToken("part1.part2.")).toBeNull();
    });

    it("returns null when IV has invalid length (not 12 bytes)", () => {
      const shortIv = Buffer.alloc(8).toString("base64url");
      const validCipher = Buffer.alloc(16).toString("base64url");
      const validAuthTag = Buffer.alloc(16).toString("base64url");

      expect(
        decryptShareToken(`${shortIv}.${validCipher}.${validAuthTag}`),
      ).toBeNull();

      const longIv = Buffer.alloc(16).toString("base64url");
      expect(
        decryptShareToken(`${longIv}.${validCipher}.${validAuthTag}`),
      ).toBeNull();
    });

    it("returns null when Auth Tag has invalid length (not 16 bytes)", () => {
      const validIv = Buffer.alloc(12).toString("base64url");
      const validCipher = Buffer.alloc(16).toString("base64url");
      const shortAuthTag = Buffer.alloc(12).toString("base64url");

      expect(
        decryptShareToken(`${validIv}.${validCipher}.${shortAuthTag}`),
      ).toBeNull();

      const longAuthTag = Buffer.alloc(20).toString("base64url");
      expect(
        decryptShareToken(`${validIv}.${validCipher}.${longAuthTag}`),
      ).toBeNull();
    });

    it("returns null for invalid base64url characters in token parts", () => {
      expect(decryptShareToken("invalid@iv!.encrypted$.tag%")).toBeNull();
    });

    it("returns null for truncated token parts", () => {
      const validToken = encryptShareToken({
        collectionId: "col_test",
        permission: "view",
        issuedAt: Date.now(),
      });
      const truncated = validToken.slice(0, 20);
      expect(decryptShareToken(truncated)).toBeNull();
    });
  });

  describe("Tampering and Cryptographic Authentication", () => {
    it("rejects token when ciphertext is modified", () => {
      const token = encryptShareToken({
        collectionId: "col_tamper",
        permission: "view",
        issuedAt: Date.now(),
      });
      const [iv, cipher, tag] = token.split(".");

      // Modify one character in ciphertext
      const tamperedCipher =
        cipher[0] === "A" ? `B${cipher.slice(1)}` : `A${cipher.slice(1)}`;
      const tamperedToken = `${iv}.${tamperedCipher}.${tag}`;

      expect(decryptShareToken(tamperedToken)).toBeNull();
    });

    it("rejects token when auth tag is modified", () => {
      const token = encryptShareToken({
        collectionId: "col_tamper_tag",
        permission: "view",
        issuedAt: Date.now(),
      });
      const [iv, cipher, tag] = token.split(".");

      const tamperedTag =
        tag[0] === "A" ? `B${tag.slice(1)}` : `A${tag.slice(1)}`;
      const tamperedToken = `${iv}.${cipher}.${tamperedTag}`;

      expect(decryptShareToken(tamperedToken)).toBeNull();
    });

    it("rejects token when IV is modified", () => {
      const token = encryptShareToken({
        collectionId: "col_tamper_iv",
        permission: "view",
        issuedAt: Date.now(),
      });
      const [iv, cipher, tag] = token.split(".");

      const tamperedIv = iv[0] === "A" ? `B${iv.slice(1)}` : `A${iv.slice(1)}`;
      const tamperedToken = `${tamperedIv}.${cipher}.${tag}`;

      expect(decryptShareToken(tamperedToken)).toBeNull();
    });

    it("rejects token encrypted with a different key", () => {
      const otherKey = crypto.randomBytes(32);
      const tokenWithOtherKey = createCustomToken(
        {
          collectionId: "col_other_key",
          permission: "view",
          issuedAt: Date.now(),
        },
        { key: otherKey },
      );

      expect(decryptShareToken(tokenWithOtherKey)).toBeNull();
    });
  });

  describe("Payload Validation and Malformed Payloads", () => {
    it("rejects payload when decrypted JSON is not an object (e.g. string or number or null)", () => {
      expect(
        decryptShareToken(createCustomToken("just a plain string")),
      ).toBeNull();
      expect(decryptShareToken(createCustomToken(123456))).toBeNull();
      expect(decryptShareToken(createCustomToken(null))).toBeNull();
      expect(decryptShareToken(createCustomToken(true))).toBeNull();
    });

    it("rejects payload with non-JSON decrypted plaintext", () => {
      expect(
        decryptShareToken(createCustomToken("{not-valid-json")),
      ).toBeNull();
    });

    it("rejects payload missing collectionId", () => {
      const payload = {
        permission: "view",
        issuedAt: Date.now(),
      };
      expect(decryptShareToken(createCustomToken(payload))).toBeNull();
    });

    it("rejects payload with empty or non-string collectionId", () => {
      expect(
        decryptShareToken(
          createCustomToken({
            collectionId: "",
            permission: "view",
            issuedAt: Date.now(),
          }),
        ),
      ).toBeNull();

      expect(
        decryptShareToken(
          createCustomToken({
            collectionId: "   ",
            permission: "view",
            issuedAt: Date.now(),
          }),
        ),
      ).toBeNull();

      expect(
        decryptShareToken(
          createCustomToken({
            collectionId: 12345,
            permission: "view",
            issuedAt: Date.now(),
          }),
        ),
      ).toBeNull();
    });

    it("rejects payload missing or invalid permission", () => {
      expect(
        decryptShareToken(
          createCustomToken({
            collectionId: "col_123",
            issuedAt: Date.now(),
          }),
        ),
      ).toBeNull();

      expect(
        decryptShareToken(
          createCustomToken({
            collectionId: "col_123",
            permission: "edit",
            issuedAt: Date.now(),
          }),
        ),
      ).toBeNull();

      expect(
        decryptShareToken(
          createCustomToken({
            collectionId: "col_123",
            permission: "admin",
            issuedAt: Date.now(),
          }),
        ),
      ).toBeNull();
    });

    it("rejects payload with missing issuedAt", () => {
      expect(
        decryptShareToken(
          createCustomToken({
            collectionId: "col_123",
            permission: "view",
          }),
        ),
      ).toBeNull();
    });

    it("rejects payload with string, null, NaN or boolean issuedAt", () => {
      expect(
        decryptShareToken(
          createCustomToken({
            collectionId: "col_123",
            permission: "view",
            issuedAt: "1700000000000",
          }),
        ),
      ).toBeNull();

      expect(
        decryptShareToken(
          createCustomToken({
            collectionId: "col_123",
            permission: "view",
            issuedAt: null,
          }),
        ),
      ).toBeNull();

      expect(
        decryptShareToken(
          createCustomToken({
            collectionId: "col_123",
            permission: "view",
            issuedAt: true,
          }),
        ),
      ).toBeNull();
    });

    it("rejects payload with negative or infinite issuedAt", () => {
      expect(
        decryptShareToken(
          createCustomToken({
            collectionId: "col_123",
            permission: "view",
            issuedAt: -100,
          }),
        ),
      ).toBeNull();

      // In JSON, Infinity serializes to null, but let's test direct injection in string
      expect(
        decryptShareToken(
          createCustomToken(
            '{"collectionId":"col_1","permission":"view","issuedAt":Infinity}',
          ),
        ),
      ).toBeNull();
    });
  });

  describe("Error Handling and Isolation", () => {
    it("returns null rather than throwing when decipher throws an unexpected error", () => {
      // Corrupt the decipher process by sending valid base64url data that fails decipher.final()
      const corruptedTag = crypto.randomBytes(16);
      const token = createCustomToken(
        { collectionId: "col_err", permission: "view", issuedAt: Date.now() },
        { authTagModifier: () => corruptedTag },
      );

      expect(() => decryptShareToken(token)).not.toThrow();
      expect(decryptShareToken(token)).toBeNull();
    });
  });
});
