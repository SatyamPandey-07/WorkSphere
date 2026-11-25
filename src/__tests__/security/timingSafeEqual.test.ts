import crypto from "node:crypto";
import {
  safeCompareSignatures,
  isValidHex,
  computeHmacSignature,
  verifyHmacWebhookSignature,
} from "@/lib/security/hmac";

describe("safeCompareSignatures & HMAC security verification", () => {
  const secret = "test-webhook-secret-key-12345";
  const payload = JSON.stringify({ event: "payment.succeeded", amount: 5000 });
  const validComputed = computeHmacSignature(payload, secret);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("isValidHex helper", () => {
    it("returns true for valid even-length hex strings", () => {
      expect(isValidHex("abcdef0123456789")).toBe(true);
      expect(isValidHex("ABCDEF0123456789")).toBe(true);
      expect(isValidHex(validComputed)).toBe(true);
    });

    it("returns false for non-string or empty inputs", () => {
      expect(isValidHex("")).toBe(false);
      expect(isValidHex(null)).toBe(false);
      expect(isValidHex(undefined)).toBe(false);
      expect(isValidHex(12345)).toBe(false);
      expect(isValidHex({})).toBe(false);
    });

    it("returns false for odd-length strings", () => {
      expect(isValidHex("abc")).toBe(false);
      expect(isValidHex("a")).toBe(false);
      expect(isValidHex("12345")).toBe(false);
    });

    it("returns false for invalid characters (non-hex)", () => {
      expect(isValidHex("abcdefgh")).toBe(false); // 'g', 'h' are not hex
      expect(isValidHex("1234zz")).toBe(false);
      expect(isValidHex("12 34")).toBe(false);
      expect(isValidHex("12-34")).toBe(false);
    });
  });

  describe("safeCompareSignatures", () => {
    it("1. Valid identical signatures return true", () => {
      expect(safeCompareSignatures(validComputed, validComputed)).toBe(true);
    });

    it("2. Invalid signatures of equal length return false", () => {
      // Create a different 64-character hex signature
      const differentSignature = computeHmacSignature(
        JSON.stringify({ event: "other" }),
        secret,
      );
      expect(differentSignature.length).toBe(validComputed.length);
      expect(safeCompareSignatures(differentSignature, validComputed)).toBe(false);
    });

    it("3. Different signature lengths return false without throwing", () => {
      const shorter = validComputed.slice(0, 32);
      const longer = validComputed + "ab";

      expect(() => {
        expect(safeCompareSignatures(shorter, validComputed)).toBe(false);
        expect(safeCompareSignatures(longer, validComputed)).toBe(false);
        expect(safeCompareSignatures(validComputed, shorter)).toBe(false);
      }).not.toThrow();
    });

    it("4. Empty signatures and falsy values are handled safely", () => {
      expect(safeCompareSignatures("", validComputed)).toBe(false);
      expect(safeCompareSignatures(validComputed, "")).toBe(false);
      expect(safeCompareSignatures("", "")).toBe(false);
      expect(safeCompareSignatures(null as any, validComputed)).toBe(false);
      expect(safeCompareSignatures(validComputed, undefined as any)).toBe(false);
      expect(safeCompareSignatures(null as any, null as any)).toBe(false);
    });

    it("5. Malformed hexadecimal signatures are rejected safely", () => {
      // Odd length
      const oddLength = validComputed.slice(0, 63);
      expect(safeCompareSignatures(oddLength, validComputed)).toBe(false);

      // Non-hex characters
      const nonHex = validComputed.slice(0, 62) + "zz";
      expect(safeCompareSignatures(nonHex, validComputed)).toBe(false);

      // Malformed expected signature
      expect(safeCompareSignatures(validComputed, "invalid-hex-here!!")).toBe(false);
    });

    it("6. Single-character signature modifications return false", () => {
      // Modify first char
      const modifiedFirst =
        (validComputed[0] === "a" ? "b" : "a") + validComputed.slice(1);
      expect(safeCompareSignatures(modifiedFirst, validComputed)).toBe(false);

      // Modify middle char
      const mid = Math.floor(validComputed.length / 2);
      const modifiedMid =
        validComputed.slice(0, mid) +
        (validComputed[mid] === "0" ? "1" : "0") +
        validComputed.slice(mid + 1);
      expect(safeCompareSignatures(modifiedMid, validComputed)).toBe(false);

      // Modify last char
      const modifiedLast =
        validComputed.slice(0, -1) +
        (validComputed[validComputed.length - 1] === "f" ? "e" : "f");
      expect(safeCompareSignatures(modifiedLast, validComputed)).toBe(false);
    });

    it("7. Handles simulated timing jitter without relying on fragile microsecond benchmarks", () => {
      // Jitter test: ensures responses are stable and correct under variable execution delays
      const testCases = [
        { sig: validComputed, expected: true },
        { sig: validComputed.slice(0, -2) + "00", expected: false },
        { sig: "invalid", expected: false },
      ];

      for (const { sig, expected } of testCases) {
        // Introduce small simulated jitter
        const jitterMs = Math.floor(Math.random() * 5);
        const start = Date.now();
        while (Date.now() - start < jitterMs) {
          // spin
        }
        const result = safeCompareSignatures(sig, validComputed);
        expect(result).toBe(expected);
      }
    });

    it("8. The native crypto.timingSafeEqual implementation is actually used for equal-length valid inputs", () => {
      const timingSafeEqualSpy = jest.spyOn(crypto, "timingSafeEqual");

      // Valid match
      const resultMatch = safeCompareSignatures(validComputed, validComputed);
      expect(resultMatch).toBe(true);
      expect(timingSafeEqualSpy).toHaveBeenCalledTimes(1);

      // Check arguments passed to timingSafeEqual
      const [bufA, bufB] = timingSafeEqualSpy.mock.calls[0];
      expect(Buffer.isBuffer(bufA)).toBe(true);
      expect(Buffer.isBuffer(bufB)).toBe(true);
      expect(bufA.length).toBe(32); // SHA256 is 32 bytes
      expect(bufB.length).toBe(32);

      // Valid equal length mismatch
      const otherValidHex = "0".repeat(64);
      const resultMismatch = safeCompareSignatures(otherValidHex, validComputed);
      expect(resultMismatch).toBe(false);
      expect(timingSafeEqualSpy).toHaveBeenCalledTimes(2);

      // Different length should NOT call timingSafeEqual (must guard against RangeError)
      timingSafeEqualSpy.mockClear();
      const unequalLength = validComputed.slice(0, 32);
      const resultUnequal = safeCompareSignatures(unequalLength, validComputed);
      expect(resultUnequal).toBe(false);
      expect(timingSafeEqualSpy).not.toHaveBeenCalled();

      // Malformed hex should NOT call timingSafeEqual
      const malformedHex = "zz".repeat(32);
      const resultMalformed = safeCompareSignatures(malformedHex, validComputed);
      expect(resultMalformed).toBe(false);
      expect(timingSafeEqualSpy).not.toHaveBeenCalled();
    });
  });

  describe("verifyHmacWebhookSignature", () => {
    it("verifies webhook signatures with and without sha256= prefix", () => {
      const headerWithPrefix = `sha256=${validComputed}`;
      expect(
        verifyHmacWebhookSignature(payload, headerWithPrefix, secret, "sha256="),
      ).toBe(true);

      const headerWithoutPrefix = validComputed;
      expect(
        verifyHmacWebhookSignature(payload, headerWithoutPrefix, secret, ""),
      ).toBe(true);
    });

    it("rejects tampered body or invalid signature", () => {
      const tamperedBody = JSON.stringify({ event: "payment.succeeded", amount: 9999 });
      expect(
        verifyHmacWebhookSignature(tamperedBody, `sha256=${validComputed}`, secret),
      ).toBe(false);

      expect(
        verifyHmacWebhookSignature(payload, "sha256=invalid", secret),
      ).toBe(false);
    });

    it("handles missing inputs safely", () => {
      expect(verifyHmacWebhookSignature(payload, null, secret)).toBe(false);
      expect(verifyHmacWebhookSignature(payload, undefined, secret)).toBe(false);
      expect(verifyHmacWebhookSignature(payload, `sha256=${validComputed}`, "")).toBe(false);
      expect(verifyHmacWebhookSignature(payload, `sha256=${validComputed}`, null as any)).toBe(false);
    });
  });
});
