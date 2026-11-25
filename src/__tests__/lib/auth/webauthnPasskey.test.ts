import {
  isWebAuthnSupported,
  isPlatformAuthenticatorAvailable,
  bufferToBase64Url,
  base64UrlToBuffer,
  serializeAuthenticationAssertion,
  requestStepUpChallenge,
  authenticateWithPasskey,
  verifyStepUpAssertion,
  performWebAuthnStepUp,
  requestStepUpEmailOtp,
  verifyStepUpEmailOtp,
  type TransactionContext,
} from "@/lib/auth/webauthnPasskey";

describe("webauthnPasskey utility", () => {
  const originalWindow = global.window;
  const originalNavigator = global.navigator;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Browser support detection", () => {
    it("returns false when window or navigator is undefined (SSR simulation)", () => {
      const origWindow = global.window;
      // @ts-ignore
      delete global.window;
      expect(isWebAuthnSupported()).toBe(false);
      global.window = origWindow;
    });

    it("returns true when PublicKeyCredential and credentials.get are present", () => {
      // @ts-ignore
      global.window.PublicKeyCredential = function () {} as any;
      Object.defineProperty(global.navigator, "credentials", {
        value: { get: jest.fn() },
        configurable: true,
      });

      expect(isWebAuthnSupported()).toBe(true);
    });

    it("isPlatformAuthenticatorAvailable returns false if not supported or check returns false", async () => {
      // @ts-ignore
      global.window.PublicKeyCredential = {
        isUserVerifyingPlatformAuthenticatorAvailable: jest.fn().mockResolvedValue(false),
      } as any;

      const available = await isPlatformAuthenticatorAvailable();
      expect(available).toBe(false);
    });

    it("isPlatformAuthenticatorAvailable returns true when supported and available", async () => {
      // @ts-ignore
      global.window.PublicKeyCredential = {
        isUserVerifyingPlatformAuthenticatorAvailable: jest.fn().mockResolvedValue(true),
      } as any;
      Object.defineProperty(global.navigator, "credentials", {
        value: { get: jest.fn() },
        configurable: true,
      });

      const available = await isPlatformAuthenticatorAvailable();
      expect(available).toBe(true);
    });
  });

  describe("Base64Url helpers", () => {
    it("correctly encodes and decodes roundtrip ArrayBuffer", () => {
      const bytes = new Uint8Array([1, 2, 3, 255, 128, 64, 0]);
      const encoded = bufferToBase64Url(bytes.buffer);
      expect(typeof encoded).toBe("string");
      expect(encoded.includes("+")).toBe(false);
      expect(encoded.includes("/")).toBe(false);
      expect(encoded.includes("=")).toBe(false);

      const decoded = base64UrlToBuffer(encoded);
      expect(new Uint8Array(decoded)).toEqual(bytes);
    });
  });

  describe("Assertion serialization", () => {
    it("serializes PublicKeyCredential assertion into standard JSON structure", () => {
      const mockCredential = {
        id: "cred-test-id",
        rawId: new Uint8Array([1, 2, 3]).buffer,
        type: "public-key",
        response: {
          clientDataJSON: new Uint8Array([10, 20, 30]).buffer,
          authenticatorData: new Uint8Array([40, 50, 60]).buffer,
          signature: new Uint8Array([70, 80, 90]).buffer,
          userHandle: new Uint8Array([100]).buffer,
        },
        getClientExtensionResults: () => ({ prf: { results: {} } }),
      } as unknown as PublicKeyCredential;

      const serialized = serializeAuthenticationAssertion(mockCredential);
      expect(serialized.id).toBe("cred-test-id");
      expect(serialized.type).toBe("public-key");
      expect(serialized.response.signature).toBeDefined();
      expect(serialized.response.userHandle).toBeDefined();
    });
  });

  describe("requestStepUpChallenge", () => {
    const txContext: TransactionContext = {
      action: "wallet_transfer",
      amount: 2.5,
      recipient: "SolRecipientWalletAddress",
    };

    it("fetches challenge options from the backend successfully", async () => {
      const mockOptions = {
        challenge: "server-challenge-string",
        rpId: "localhost",
        allowCredentials: [],
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ options: mockOptions, action: "wallet_transfer" }),
      } as Response);

      const result = await requestStepUpChallenge(txContext);
      expect(result.options.challenge).toBe("server-challenge-string");
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("amount=2.5"),
        expect.objectContaining({ method: "GET" })
      );
    });

    it("throws error if server returns error response", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: "Rate limit exceeded" }),
      } as Response);

      await expect(requestStepUpChallenge(txContext)).rejects.toThrow("Rate limit exceeded");
    });
  });

  describe("authenticateWithPasskey", () => {
    it("calls navigator.credentials.get with converted buffers and returns serialized assertion", async () => {
      const mockCred = {
        id: "test-auth-id",
        rawId: new Uint8Array([1, 2, 3]).buffer,
        type: "public-key",
        response: {
          clientDataJSON: new Uint8Array([10, 20]).buffer,
          authenticatorData: new Uint8Array([30, 40]).buffer,
          signature: new Uint8Array([50, 60]).buffer,
        },
      };

      const getMock = jest.fn().mockResolvedValue(mockCred);
      Object.defineProperty(global.navigator, "credentials", {
        value: { get: getMock },
        configurable: true,
      });
      // @ts-ignore
      global.window.PublicKeyCredential = function () {} as any;

      const assertion = await authenticateWithPasskey({
        challenge: bufferToBase64Url(new Uint8Array([99, 88]).buffer),
        rpId: "localhost",
      });

      expect(getMock).toHaveBeenCalled();
      expect(assertion.id).toBe("test-auth-id");
    });

    it("throws if navigator.credentials.get resolves to null", async () => {
      Object.defineProperty(global.navigator, "credentials", {
        value: { get: jest.fn().mockResolvedValue(null) },
        configurable: true,
      });

      await expect(
        authenticateWithPasskey({
          challenge: bufferToBase64Url(new Uint8Array([99, 88]).buffer),
          rpId: "localhost",
        })
      ).rejects.toThrow("No credential was returned");
    });
  });

  describe("verifyStepUpAssertion", () => {
    const txContext: TransactionContext = {
      action: "escrow_settle",
      amount: 5.0,
    };

    it("submits assertion and receives single-use stepUpToken", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          verified: true,
          stepUpToken: "valid.stepup.token",
        }),
      } as Response);

      const res = await verifyStepUpAssertion(
        { id: "c1", rawId: "c1", type: "public-key", response: {} as any },
        txContext
      );

      expect(res.verified).toBe(true);
      expect(res.stepUpToken).toBe("valid.stepup.token");
    });

    it("throws if verification fails on server", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Signature verification failed" }),
      } as Response);

      await expect(
        verifyStepUpAssertion(
          { id: "c1", rawId: "c1", type: "public-key", response: {} as any },
          txContext
        )
      ).rejects.toThrow("Signature verification failed");
    });
  });

  describe("performWebAuthnStepUp orchestration", () => {
    const txContext: TransactionContext = {
      action: "refund",
      amount: 3.0,
    };

    it("completes full flow returning success and token", async () => {
      // Mock challenge fetch
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            options: { challenge: "ch1" },
            action: "refund",
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            verified: true,
            stepUpToken: "jwt.stepup.token",
          }),
        } as Response);

      const mockCred = {
        id: "cred-1",
        rawId: new Uint8Array([1]).buffer,
        type: "public-key",
        response: {
          clientDataJSON: new Uint8Array([1]).buffer,
          authenticatorData: new Uint8Array([2]).buffer,
          signature: new Uint8Array([3]).buffer,
        },
      };

      Object.defineProperty(global.navigator, "credentials", {
        value: { get: jest.fn().mockResolvedValue(mockCred) },
        configurable: true,
      });
      // @ts-ignore
      global.window.PublicKeyCredential = function () {} as any;

      const result = await performWebAuthnStepUp(txContext);
      expect(result.success).toBe(true);
      expect(result.type).toBe("success");
      expect(result.stepUpToken).toBe("jwt.stepup.token");
    });

    it("handles user cancellation gracefully", async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          options: { challenge: "ch1" },
          action: "refund",
        }),
      } as Response);

      const cancelErr = new Error("The operation either timed out or was not allowed");
      cancelErr.name = "NotAllowedError";

      Object.defineProperty(global.navigator, "credentials", {
        value: { get: jest.fn().mockRejectedValue(cancelErr) },
        configurable: true,
      });

      const result = await performWebAuthnStepUp(txContext);
      expect(result.success).toBe(false);
      expect(result.type).toBe("user_cancelled");
      expect(result.error).toContain("cancelled");
    });
  });

  describe("Email OTP fallback", () => {
    it("requests OTP and returns masked email", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, maskedEmail: "s•••p@example.com", expiresInSeconds: 300 }),
      } as Response);

      const res = await requestStepUpEmailOtp({ action: "wallet_transfer", amount: 10 });
      expect(res.success).toBe(true);
      expect(res.maskedEmail).toBe("s•••p@example.com");
    });

    it("verifies OTP and receives stepUpToken", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ verified: true, stepUpToken: "otp.stepup.token" }),
      } as Response);

      const res = await verifyStepUpEmailOtp({
        code: "123456",
        action: "wallet_transfer",
        amount: 10,
      });

      expect(res.success).toBe(true);
      expect(res.stepUpToken).toBe("otp.stepup.token");
      expect(res.usedFallback).toBe(true);
    });

    it("returns error on invalid OTP", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Invalid verification code" }),
      } as Response);

      const res = await verifyStepUpEmailOtp({
        code: "000000",
        action: "wallet_transfer",
        amount: 10,
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe("Invalid verification code");
    });
  });
});
