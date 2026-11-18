import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  CSRF_MIN_ENTROPY_BYTES,
  CSRF_MIN_ENTROPY_BITS,
  CSRF_TOKEN_BYTE_LENGTH,
  base64UrlEncode,
  base64UrlDecode,
  validateCsrfTokenEntropy,
  generateCsrfRawToken,
  timingSafeEqual,
  issueCsrfToken,
  verifyCsrfToken,
  isCsrfProtectedMethod,
} from "../../lib/security/csrf";

describe("CSRF Token Entropy and Timing-Safe Verification", () => {
  describe("Cryptographically secure random token generation", () => {
    it("enforces minimum 256-bit (32 bytes) entropy constants", () => {
      expect(CSRF_MIN_ENTROPY_BYTES).toBe(32);
      expect(CSRF_MIN_ENTROPY_BITS).toBe(256);
      expect(CSRF_TOKEN_BYTE_LENGTH).toBe(32);
    });

    it("generates tokens that meet the 32-byte entropy requirement", () => {
      const raw = generateCsrfRawToken();
      expect(typeof raw).toBe("string");
      expect(validateCsrfTokenEntropy(raw)).toBe(true);

      const decoded = base64UrlDecode(raw);
      expect(decoded).not.toBeNull();
      expect(decoded!.byteLength).toBeGreaterThanOrEqual(32);
    });

    it("throws an error when attempting to generate tokens with less than 32 bytes entropy", () => {
      expect(() => generateCsrfRawToken(16)).toThrow(
        /entropy must be at least 32 bytes/i
      );
      expect(() => generateCsrfRawToken(0)).toThrow(
        /entropy must be at least 32 bytes/i
      );
    });

    it("generates distinct high-entropy tokens on subsequent calls", () => {
      const tokenA = generateCsrfRawToken();
      const tokenB = generateCsrfRawToken();
      expect(tokenA).not.toEqual(tokenB);
    });

    it("issues signed CSRF tokens with valid raw entropy and proper format", async () => {
      const { cookieValue, raw } = await issueCsrfToken();
      expect(cookieValue).toContain(".");
      expect(cookieValue.startsWith(raw)).toBe(true);
      expect(validateCsrfTokenEntropy(raw)).toBe(true);
    });
  });

  describe("Token entropy validation (validateCsrfTokenEntropy)", () => {
    it("accepts base64url tokens with at least 32 bytes of entropy", () => {
      const bytes32 = new Uint8Array(32);
      crypto.getRandomValues(bytes32);
      const token32 = base64UrlEncode(bytes32);
      expect(validateCsrfTokenEntropy(token32)).toBe(true);

      const bytes64 = new Uint8Array(64);
      crypto.getRandomValues(bytes64);
      const token64 = base64UrlEncode(bytes64);
      expect(validateCsrfTokenEntropy(token64)).toBe(true);
    });

    it("rejects tokens with fewer than 32 bytes of entropy", () => {
      const bytes16 = new Uint8Array(16);
      crypto.getRandomValues(bytes16);
      const token16 = base64UrlEncode(bytes16);
      expect(validateCsrfTokenEntropy(token16)).toBe(false);

      const bytes24 = new Uint8Array(24);
      crypto.getRandomValues(bytes24);
      const token24 = base64UrlEncode(bytes24);
      expect(validateCsrfTokenEntropy(token24)).toBe(false);
    });

    it("rejects short or trivial non-cryptographic strings", () => {
      expect(validateCsrfTokenEntropy("short")).toBe(false);
      expect(validateCsrfTokenEntropy("weak-token")).toBe(false);
      expect(validateCsrfTokenEntropy("1234567890")).toBe(false);
      expect(validateCsrfTokenEntropy("")).toBe(false);
    });

    it("rejects null, undefined, or non-string inputs", () => {
      expect(validateCsrfTokenEntropy(null)).toBe(false);
      expect(validateCsrfTokenEntropy(undefined)).toBe(false);
      expect(validateCsrfTokenEntropy(12345 as unknown as string)).toBe(false);
    });

    it("rejects strings containing invalid characters", () => {
      expect(validateCsrfTokenEntropy("token-with-invalid-chars!@#$%^&*()")).toBe(false);
    });

    it("accepts valid 64-character hex-encoded tokens (32 bytes) and rejects shorter hex tokens", () => {
      const validHex = "a".repeat(64);
      expect(validateCsrfTokenEntropy(validHex)).toBe(true);

      const shortHex = "b".repeat(32); // only 16 bytes
      expect(validateCsrfTokenEntropy(shortHex)).toBe(false);
    });
  });

  describe("timingSafeEqual comparison", () => {
    it("returns true for identical strings", () => {
      expect(timingSafeEqual("secure-token-value-12345", "secure-token-value-12345")).toBe(true);
    });

    it("returns false for different strings of the same length", () => {
      expect(timingSafeEqual("secure-token-value-1234a", "secure-token-value-1234b")).toBe(false);
    });

    it("returns false for strings of different lengths", () => {
      expect(timingSafeEqual("short", "much-longer-string-value")).toBe(false);
      expect(timingSafeEqual("longer-string-value", "short")).toBe(false);
    });

    it("returns true for identical Uint8Arrays", () => {
      const a = new Uint8Array([1, 2, 3, 4, 5]);
      const b = new Uint8Array([1, 2, 3, 4, 5]);
      expect(timingSafeEqual(a, b)).toBe(true);
    });

    it("returns false for different Uint8Arrays of same length", () => {
      const a = new Uint8Array([1, 2, 3, 4, 5]);
      const b = new Uint8Array([1, 2, 3, 4, 6]);
      expect(timingSafeEqual(a, b)).toBe(false);
    });

    it("returns false for different Uint8Arrays of different lengths", () => {
      const a = new Uint8Array([1, 2, 3]);
      const b = new Uint8Array([1, 2, 3, 4, 5]);
      expect(timingSafeEqual(a, b)).toBe(false);
    });

    it("returns false for null or undefined arguments", () => {
      expect(timingSafeEqual(null as unknown as string, "test")).toBe(false);
      expect(timingSafeEqual("test", undefined as unknown as string)).toBe(false);
    });
  });

  describe("verifyCsrfToken with entropy and timing-safety enforcement", () => {
    it("successfully verifies a legitimate token pair with 256-bit entropy", async () => {
      const { cookieValue, raw } = await issueCsrfToken();
      const isValid = await verifyCsrfToken(cookieValue, raw);
      expect(isValid).toBe(true);
    });

    it("rejects verification when the header token lacks 256-bit entropy", async () => {
      const { cookieValue } = await issueCsrfToken();
      const isValid = await verifyCsrfToken(cookieValue, "low-entropy-token");
      expect(isValid).toBe(false);
    });

    it("rejects verification when the cookie raw token lacks 256-bit entropy", async () => {
      const lowEntropyRaw = "short-token";
      const fakeCookie = `${lowEntropyRaw}.fake-signature`;
      const isValid = await verifyCsrfToken(fakeCookie, lowEntropyRaw);
      expect(isValid).toBe(false);
    });

    it("rejects verification when header token does not match cookie raw token even with high entropy", async () => {
      const { cookieValue } = await issueCsrfToken();
      const otherHighEntropyToken = generateCsrfRawToken();
      const isValid = await verifyCsrfToken(cookieValue, otherHighEntropyToken);
      expect(isValid).toBe(false);
    });

    it("rejects verification when signature is tampered", async () => {
      const { cookieValue, raw } = await issueCsrfToken();
      const separatorIndex = cookieValue.lastIndexOf(".");
      const tamperedCookie = `${cookieValue.slice(0, separatorIndex)}.tampered-signature-value`;
      const isValid = await verifyCsrfToken(tamperedCookie, raw);
      expect(isValid).toBe(false);
    });

    it("rejects verification when cookie or header is missing or malformed", async () => {
      const { cookieValue, raw } = await issueCsrfToken();
      expect(await verifyCsrfToken(undefined, raw)).toBe(false);
      expect(await verifyCsrfToken(cookieValue, undefined)).toBe(false);
      expect(await verifyCsrfToken(null, null)).toBe(false);
      expect(await verifyCsrfToken("cookie-without-dot-separator", raw)).toBe(false);
    });
  });

  describe("API Mutation HTTP Methods Validation", () => {
    it("protects state-mutating HTTP methods", () => {
      expect(isCsrfProtectedMethod("POST")).toBe(true);
      expect(isCsrfProtectedMethod("post")).toBe(true);
      expect(isCsrfProtectedMethod("PUT")).toBe(true);
      expect(isCsrfProtectedMethod("put")).toBe(true);
      expect(isCsrfProtectedMethod("PATCH")).toBe(true);
      expect(isCsrfProtectedMethod("patch")).toBe(true);
      expect(isCsrfProtectedMethod("DELETE")).toBe(true);
      expect(isCsrfProtectedMethod("delete")).toBe(true);
    });

    it("does not require CSRF checks on safe HTTP methods", () => {
      expect(isCsrfProtectedMethod("GET")).toBe(false);
      expect(isCsrfProtectedMethod("get")).toBe(false);
      expect(isCsrfProtectedMethod("HEAD")).toBe(false);
      expect(isCsrfProtectedMethod("head")).toBe(false);
      expect(isCsrfProtectedMethod("OPTIONS")).toBe(false);
      expect(isCsrfProtectedMethod("options")).toBe(false);
      expect(isCsrfProtectedMethod(null)).toBe(false);
      expect(isCsrfProtectedMethod(undefined)).toBe(false);
    });
  });
});
