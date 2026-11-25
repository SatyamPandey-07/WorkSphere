import {
  getSplitPaymentSecret,
  generateSplitPaymentToken,
  verifySplitPaymentToken,
  INSECURE_DEFAULT_SECRET,
  MIN_SPLIT_SECRET_LENGTH,
} from "@/lib/billing/splitPayment";

describe("Fail-Closed SPLIT_PAYMENT_SECRET Configuration (Issue #10070)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const validProductionSecret =
    "a-very-long-and-secure-random-split-payment-secret-key-32chars";

  const samplePayload = {
    bookingId: "b-123",
    guestId: "g-456",
    email: "guest@example.com",
    amount: 50,
    currency: "USD",
    venueName: "Downtown Lounge",
    date: "2026-12-01",
    time: "10:00",
  };

  describe("Production Environment (NODE_ENV = 'production')", () => {
    beforeEach(() => {
      (process.env as any).NODE_ENV = "production";
    });

    it("should fail closed and throw error when SPLIT_PAYMENT_SECRET is unset", () => {
      delete process.env.SPLIT_PAYMENT_SECRET;

      expect(() => getSplitPaymentSecret()).toThrow(
        "SPLIT_PAYMENT_SECRET environment variable is missing in production",
      );
      expect(() => generateSplitPaymentToken(samplePayload)).toThrow(
        "SPLIT_PAYMENT_SECRET environment variable is missing in production",
      );
      expect(() =>
        verifySplitPaymentToken("eyJuYW1lIjoidGVzdCJ9.invalidsig"),
      ).toThrow(
        "SPLIT_PAYMENT_SECRET environment variable is missing in production",
      );
    });

    it("should fail closed when SPLIT_PAYMENT_SECRET is empty string", () => {
      process.env.SPLIT_PAYMENT_SECRET = "   ";

      expect(() => getSplitPaymentSecret()).toThrow(
        "SPLIT_PAYMENT_SECRET environment variable is missing in production",
      );
    });

    it("should reject insecure default secret in production", () => {
      process.env.SPLIT_PAYMENT_SECRET = INSECURE_DEFAULT_SECRET;

      expect(() => getSplitPaymentSecret()).toThrow(
        "SPLIT_PAYMENT_SECRET is set to an insecure default value in production",
      );
    });

    it("should reject weak secret with length below 32 characters in production", () => {
      process.env.SPLIT_PAYMENT_SECRET = "short-secret-less-than-32-chars";
      expect(
        process.env.SPLIT_PAYMENT_SECRET.length < MIN_SPLIT_SECRET_LENGTH,
      ).toBe(true);

      expect(() => getSplitPaymentSecret()).toThrow(
        "SPLIT_PAYMENT_SECRET is too short in production",
      );
    });

    it("should succeed and sign/verify tokens when valid high-entropy secret is configured", () => {
      process.env.SPLIT_PAYMENT_SECRET = validProductionSecret;

      const secret = getSplitPaymentSecret();
      expect(secret).toBe(validProductionSecret);

      const token = generateSplitPaymentToken(samplePayload);
      expect(token).toBeDefined();

      const decoded = verifySplitPaymentToken(token);
      expect(decoded).not.toBeNull();
      expect(decoded?.bookingId).toBe("b-123");
      expect(decoded?.guestId).toBe("g-456");
      expect(decoded?.amount).toBe(50);
    });
  });

  describe("Non-Production Environments (development / test)", () => {
    beforeEach(() => {
      (process.env as any).NODE_ENV = "test";
    });

    it("should fall back to controlled development secret when unset in test", () => {
      delete process.env.SPLIT_PAYMENT_SECRET;

      const secret = getSplitPaymentSecret();
      expect(secret).toBe(INSECURE_DEFAULT_SECRET);

      const token = generateSplitPaymentToken(samplePayload);
      const decoded = verifySplitPaymentToken(token);
      expect(decoded?.bookingId).toBe("b-123");
    });

    it("should use explicit SPLIT_PAYMENT_SECRET when provided in test", () => {
      process.env.SPLIT_PAYMENT_SECRET = "custom-test-secret";

      const secret = getSplitPaymentSecret();
      expect(secret).toBe("custom-test-secret");
    });

    it("should reject tokens verified with a different secret", () => {
      process.env.SPLIT_PAYMENT_SECRET = "secret-key-version-one-1234567890";
      const token = generateSplitPaymentToken(samplePayload);

      // Rotate to secret two
      process.env.SPLIT_PAYMENT_SECRET = "secret-key-version-two-0987654321";
      const decoded = verifySplitPaymentToken(token);
      expect(decoded).toBeNull();
    });

    it("should reject tampered token signatures", () => {
      process.env.SPLIT_PAYMENT_SECRET = validProductionSecret;
      const token = generateSplitPaymentToken(samplePayload);
      const [payloadPart, _signature] = token.split(".");

      const tamperedToken = `${payloadPart}.corruptedSignatureHere`;
      expect(verifySplitPaymentToken(tamperedToken)).toBeNull();
    });
  });
});
