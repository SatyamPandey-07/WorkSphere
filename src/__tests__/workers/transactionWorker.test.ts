/**
 * Tests for transactionWorker HMAC-SHA256 signature verification hardening.
 */

import {
  decodeHexSignature,
  verifyWebhookSignature,
} from "@/workers/transactionWorker";

describe("transactionWorker - HMAC-SHA256 Verification Hardening", () => {
  const secret = "test-merchant-secret-key-2026";
  const body = JSON.stringify({
    transactionId: "tx_12345",
    amount: 49.99,
    currency: "USD",
  });

  let validHexSignature: string;

  beforeAll(async () => {
    // Generate an authentic HMAC-SHA256 signature using Web Crypto for testing
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signatureBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(body),
    );
    validHexSignature = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  });

  describe("decodeHexSignature", () => {
    it("decodes a valid 64-character lowercase hex signature into 32 bytes", () => {
      const bytes = decodeHexSignature(validHexSignature);
      expect(bytes).not.toBeNull();
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes?.length).toBe(32);
    });

    it("decodes a valid 64-character uppercase hex signature", () => {
      const bytes = decodeHexSignature(validHexSignature.toUpperCase());
      expect(bytes).not.toBeNull();
      expect(bytes?.length).toBe(32);
    });

    it("rejects non-string input safely", () => {
      expect(decodeHexSignature(null)).toBeNull();
      expect(decodeHexSignature(undefined)).toBeNull();
      expect(decodeHexSignature(12345)).toBeNull();
      expect(decodeHexSignature({})).toBeNull();
    });

    it("rejects empty string", () => {
      expect(decodeHexSignature("")).toBeNull();
    });

    it("rejects signatures with leading or trailing whitespace", () => {
      expect(decodeHexSignature(` ${validHexSignature}`)).toBeNull();
      expect(decodeHexSignature(`${validHexSignature} `)).toBeNull();
      expect(decodeHexSignature(`\t${validHexSignature}\n`)).toBeNull();
    });

    it("rejects odd-length hex strings", () => {
      expect(decodeHexSignature("abcdef1")).toBeNull();
      expect(decodeHexSignature(validHexSignature.slice(0, 63))).toBeNull();
    });

    it("rejects incorrect lengths", () => {
      // 30 bytes (60 hex chars)
      expect(decodeHexSignature("a".repeat(60))).toBeNull();
      // 33 bytes (66 hex chars)
      expect(decodeHexSignature("a".repeat(66))).toBeNull();
    });

    it("rejects invalid non-hex characters", () => {
      const invalidHex = "z".repeat(64);
      expect(decodeHexSignature(invalidHex)).toBeNull();

      const withPunctuation = validHexSignature.slice(0, 62) + "!!";
      expect(decodeHexSignature(withPunctuation)).toBeNull();
    });
  });

  describe("verifyWebhookSignature with native Web Crypto verify", () => {
    it("returns isValid: true for an authentic HMAC-SHA256 signature", async () => {
      const isValid = await verifyWebhookSignature({
        body,
        signature: validHexSignature,
        secret,
      });
      expect(isValid).toBe(true);
    });

    it("returns isValid: true for an uppercase valid signature", async () => {
      const isValid = await verifyWebhookSignature({
        body,
        signature: validHexSignature.toUpperCase(),
        secret,
      });
      expect(isValid).toBe(true);
    });

    it("returns isValid: false for first-byte mismatch", async () => {
      // Flip the first nibble
      const firstChar = validHexSignature[0];
      const alteredChar = firstChar === "0" ? "1" : "0";
      const tampered = alteredChar + validHexSignature.slice(1);

      const isValid = await verifyWebhookSignature({
        body,
        signature: tampered,
        secret,
      });
      expect(isValid).toBe(false);
    });

    it("returns isValid: false for middle-byte mismatch", async () => {
      // Flip a character around the 32nd position
      const midChar = validHexSignature[32];
      const alteredChar = midChar === "a" ? "b" : "a";
      const tampered =
        validHexSignature.slice(0, 32) +
        alteredChar +
        validHexSignature.slice(33);

      const isValid = await verifyWebhookSignature({
        body,
        signature: tampered,
        secret,
      });
      expect(isValid).toBe(false);
    });

    it("returns isValid: false for last-byte mismatch", async () => {
      // Flip the last character
      const lastChar = validHexSignature[63];
      const alteredChar = lastChar === "f" ? "e" : "f";
      const tampered = validHexSignature.slice(0, 63) + alteredChar;

      const isValid = await verifyWebhookSignature({
        body,
        signature: tampered,
        secret,
      });
      expect(isValid).toBe(false);
    });

    it("returns isValid: false for wrong secret", async () => {
      const isValid = await verifyWebhookSignature({
        body,
        signature: validHexSignature,
        secret: "different-secret-key",
      });
      expect(isValid).toBe(false);
    });

    it("returns isValid: false for tampered body", async () => {
      const tamperedBody = JSON.stringify({
        transactionId: "tx_12345",
        amount: 999.99,
        currency: "USD",
      });
      const isValid = await verifyWebhookSignature({
        body: tamperedBody,
        signature: validHexSignature,
        secret,
      });
      expect(isValid).toBe(false);
    });

    it("returns isValid: false for empty or missing signature", async () => {
      expect(
        await verifyWebhookSignature({
          body,
          signature: "",
          secret,
        }),
      ).toBe(false);

      expect(
        await verifyWebhookSignature({
          body,
          signature: null as unknown as string,
          secret,
        }),
      ).toBe(false);
    });

    it("returns isValid: false for malformed or incorrect length hex signatures", async () => {
      expect(
        await verifyWebhookSignature({
          body,
          signature: "not-a-valid-hex-string",
          secret,
        }),
      ).toBe(false);

      expect(
        await verifyWebhookSignature({
          body,
          signature: validHexSignature.slice(0, 32),
          secret,
        }),
      ).toBe(false);
    });

    it("returns isValid: false for empty or invalid secret", async () => {
      expect(
        await verifyWebhookSignature({
          body,
          signature: validHexSignature,
          secret: "",
        }),
      ).toBe(false);

      expect(
        await verifyWebhookSignature({
          body,
          signature: validHexSignature,
          secret: null as unknown as string,
        }),
      ).toBe(false);
    });

    it("returns isValid: false when crypto.subtle throws", async () => {
      const originalVerify = crypto.subtle.verify;
      try {
        crypto.subtle.verify = jest
          .fn()
          .mockRejectedValue(new Error("SubtleCrypto failure"));

        const isValid = await verifyWebhookSignature({
          body,
          signature: validHexSignature,
          secret,
        });
        expect(isValid).toBe(false);
      } finally {
        crypto.subtle.verify = originalVerify;
      }
    });
  });

  describe("Worker event message contract", () => {
    it("posts WEBHOOK_VERIFIED message to self when called in worker context", async () => {
      const mockPostMessage = jest.fn();
      const originalSelf = (globalThis as any).self;

      try {
        (globalThis as any).self = {
          postMessage: mockPostMessage,
        };

        await verifyWebhookSignature({
          body,
          signature: validHexSignature,
          secret,
        });

        expect(mockPostMessage).toHaveBeenCalledWith({
          type: "WEBHOOK_VERIFIED",
          isValid: true,
        });
      } finally {
        (globalThis as any).self = originalSelf;
      }
    });
  });
});
