import {
  generateCodeVerifier,
  generateCodeChallenge,
  validateCodeVerifier,
} from "@/lib/auth/sso/pkce";
import { initiatePkceFlow, validatePkceFlow } from "@/lib/auth/sso/pkceClient";

describe("PKCE Utilities", () => {
  describe("generateCodeVerifier", () => {
    it("should generate a code verifier of default length 128", () => {
      const verifier = generateCodeVerifier();
      expect(verifier.length).toBe(128);
    });

    it("should generate a code verifier of specified length", () => {
      const verifier = generateCodeVerifier(64);
      expect(verifier.length).toBe(64);
    });

    it("should throw an error if length is less than 43", () => {
      expect(() => generateCodeVerifier(42)).toThrow(
        "Code verifier length must be between 43 and 128 characters",
      );
    });

    it("should throw an error if length is greater than 128", () => {
      expect(() => generateCodeVerifier(129)).toThrow(
        "Code verifier length must be between 43 and 128 characters",
      );
    });
  });

  describe("generateCodeChallenge", () => {
    it("should generate a valid code challenge from a verifier", () => {
      const verifier = "my-test-verifier";
      const challenge = generateCodeChallenge(verifier);
      expect(typeof challenge).toBe("string");
      expect(challenge).not.toBe(verifier);
    });
  });

  describe("validateCodeVerifier", () => {
    it("should validate a correct verifier and challenge pair", () => {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);
      expect(validateCodeVerifier(verifier, challenge)).toBe(true);
    });

    it("should fail validation for an incorrect verifier", () => {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);
      const fakeVerifier = generateCodeVerifier();
      expect(validateCodeVerifier(fakeVerifier, challenge)).toBe(false);
    });
  });
});

describe("PKCE Client Helpers", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  describe("initiatePkceFlow", () => {
    it("should initiate PKCE flow successfully", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          verifier: "test-v",
          challenge: "test-c",
        }),
      });

      const result = await initiatePkceFlow();
      expect(result).toEqual({ verifier: "test-v", challenge: "test-c" });
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/auth/sso/pkce",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "generate" }),
        }),
      );
    });

    it("should return null if the fetch fails", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
      });

      const result = await initiatePkceFlow();
      expect(result).toBeNull();
    });
  });

  describe("validatePkceFlow", () => {
    it("should validate PKCE flow successfully", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ isValid: true }),
      });

      const result = await validatePkceFlow("v", "c");
      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/auth/sso/pkce",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "validate",
            verifier: "v",
            challenge: "c",
          }),
        }),
      );
    });

    it("should return false if the validation fails", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ isValid: false }),
      });

      const result = await validatePkceFlow("v", "c");
      expect(result).toBe(false);
    });
  });
});
