import {
  generateAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  rotateRefreshToken,
  revokeRefreshTokenFamily,
  verifyJwt,
  signJwt,
  _resetTokenFamilyStoreForTesting,
} from "@/lib/auth/sessionTokens";

describe("sessionTokens", () => {
  beforeEach(() => {
    _resetTokenFamilyStoreForTesting();
  });

  describe("Access Tokens", () => {
    it("generates and verifies a valid access token", async () => {
      const token = await generateAccessToken({
        sub: "user_123",
        email: "alice@example.com",
        role: "user",
      });

      expect(typeof token).toBe("string");
      expect(token.split(".").length).toBe(3);

      const claims = await verifyAccessToken(token);
      expect(claims).not.toBeNull();
      expect(claims?.sub).toBe("user_123");
      expect(claims?.email).toBe("alice@example.com");
      expect(claims?.role).toBe("user");
      expect(claims?.tokenType).toBe("access");
      expect(typeof claims?.exp).toBe("number");
    });

    it("rejects an expired access token", async () => {
      // Generate with -10 seconds expiration
      const token = await generateAccessToken(
        { sub: "user_expired" },
        -10,
      );

      const claims = await verifyAccessToken(token);
      expect(claims).toBeNull();
    });

    it("rejects a tampered access token", async () => {
      const token = await generateAccessToken({ sub: "user_tamper" });
      const parts = token.split(".");
      // Tamper payload
      const tampered = `${parts[0]}.eyJhZG1pbiI6dHJ1ZX0.${parts[2]}`;

      const claims = await verifyAccessToken(tampered);
      expect(claims).toBeNull();
    });
  });

  describe("Rotating Refresh Tokens & Reuse Detection", () => {
    it("generates and rotates a refresh token successfully", async () => {
      const initialToken = await generateRefreshToken("user_456");
      expect(typeof initialToken).toBe("string");

      const rotation1 = await rotateRefreshToken(initialToken, {
        email: "bob@example.com",
      });

      expect(rotation1.success).toBe(true);
      if (rotation1.success) {
        expect(rotation1.userId).toBe("user_456");
        expect(typeof rotation1.accessToken).toBe("string");
        expect(typeof rotation1.refreshToken).toBe("string");
        expect(rotation1.refreshToken).not.toBe(initialToken);

        const accessClaims = await verifyAccessToken(rotation1.accessToken);
        expect(accessClaims?.sub).toBe("user_456");
        expect(accessClaims?.email).toBe("bob@example.com");

        // Second rotation using the new refresh token
        const rotation2 = await rotateRefreshToken(rotation1.refreshToken);
        expect(rotation2.success).toBe(true);
      }
    });

    it("detects refresh token reuse and revokes entire family (theft protection)", async () => {
      const initialToken = await generateRefreshToken("user_theft_victim");

      // Legitimate user rotates token
      const legitRotation = await rotateRefreshToken(initialToken);
      expect(legitRotation.success).toBe(true);

      if (legitRotation.success) {
        // Attacker attempts to replay the already-used `initialToken`
        const replayAttempt = await rotateRefreshToken(initialToken);
        expect(replayAttempt.success).toBe(false);
        if (!replayAttempt.success) {
          expect(replayAttempt.error).toBe("REUSE_DETECTED");
        }

        // Even the legitimate new token is now revoked for security
        const subsequentAttempt = await rotateRefreshToken(legitRotation.refreshToken);
        expect(subsequentAttempt.success).toBe(false);
        if (!subsequentAttempt.success) {
          expect(subsequentAttempt.error).toBe("REVOKED");
        }
      }
    });

    it("revokes token family on explicit revocation", async () => {
      const token = await generateRefreshToken("user_revoke_test");
      const revoked = await revokeRefreshTokenFamily(token);
      expect(revoked).toBe(true);

      const attempt = await rotateRefreshToken(token);
      expect(attempt.success).toBe(false);
      if (!attempt.success) {
        expect(attempt.error).toBe("REVOKED");
      }
    });
  });
});
