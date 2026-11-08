/**
 * DTLSHandshake.test.ts
 * Security and functionality tests for DTLS stateless cookie verification,
 * 60-second sliding timestamp window, rotating server secret, and anti-replay protection (#5440).
 */

import { DTLSHandshake } from "@/core/network/DTLSHandshake";

describe("DTLSHandshake Stateless Cookie & Anti-Replay Sliding Window (#5440)", () => {
  const clientIp = "198.51.100.42";
  const clientPort = 54321;
  const clientRandom = "c0ffee1234567890abcdef";

  describe("Stateless Cookie Generation & Validation", () => {
    it("generates a valid stateless cookie embedding timestamp and HMAC-SHA256 signature", () => {
      const dtls = new DTLSHandshake();
      const baseTime = 1700000000000;
      const cookie = dtls.generateStatelessCookie(
        clientIp,
        clientPort,
        clientRandom,
        baseTime,
      );

      expect(typeof cookie).toBe("string");
      expect(cookie).toContain(":");

      const [tsStr, signature] = cookie.split(":");
      expect(parseInt(tsStr, 10)).toBe(baseTime);
      expect(signature).toHaveLength(64); // SHA-256 hex signature

      const isValid = dtls.verifyStatelessCookie(
        cookie,
        clientIp,
        clientPort,
        clientRandom,
        baseTime,
      );
      expect(isValid).toBe(true);
    });

    it("successfully verifies cookies presented within the 60-second sliding window", () => {
      const dtls = new DTLSHandshake();
      const t0 = 1700000000000;
      const cookie = dtls.generateStatelessCookie(
        clientIp,
        clientPort,
        clientRandom,
        t0,
      );

      // Verify at t0 + 10s
      expect(
        dtls.verifyStatelessCookie(
          cookie,
          clientIp,
          clientPort,
          clientRandom,
          t0 + 10_000,
        ),
      ).toBe(true);

      // Verify at t0 + 30s
      expect(
        dtls.verifyStatelessCookie(
          cookie,
          clientIp,
          clientPort,
          clientRandom,
          t0 + 30_000,
        ),
      ).toBe(true);

      // Verify at t0 + 59.9s (boundary of the 60s sliding window)
      expect(
        dtls.verifyStatelessCookie(
          cookie,
          clientIp,
          clientPort,
          clientRandom,
          t0 + 59_900,
        ),
      ).toBe(true);
    });

    it("rejects replayed cookies older than 60 seconds", () => {
      const dtls = new DTLSHandshake();
      const t0 = 1700000000000;
      const cookie = dtls.generateStatelessCookie(
        clientIp,
        clientPort,
        clientRandom,
        t0,
      );

      // Replay attempt at 61 seconds (expired)
      const result61s = dtls.validateStatelessCookie(
        cookie,
        clientIp,
        clientPort,
        clientRandom,
        t0 + 61_000,
      );
      expect(result61s.isValid).toBe(false);
      expect(result61s.reason).toBe("expired");
      expect(result61s.ageMs).toBe(61_000);

      // Replay attempt at 120 seconds
      const result120s = dtls.validateStatelessCookie(
        cookie,
        clientIp,
        clientPort,
        clientRandom,
        t0 + 120_000,
      );
      expect(result120s.isValid).toBe(false);
      expect(result120s.reason).toBe("expired");

      // verifyStatelessCookie boolean helper also returns false
      expect(
        dtls.verifyStatelessCookie(
          cookie,
          clientIp,
          clientPort,
          clientRandom,
          t0 + 60_001,
        ),
      ).toBe(false);
    });

    it("rejects cookies with future timestamps exceeding allowable clock skew (5 seconds)", () => {
      const dtls = new DTLSHandshake();
      const t0 = 1700000000000;
      // Cookie timestamp 10 seconds in the future
      const futureCookie = dtls.generateStatelessCookie(
        clientIp,
        clientPort,
        clientRandom,
        t0 + 10_000,
      );

      const result = dtls.validateStatelessCookie(
        futureCookie,
        clientIp,
        clientPort,
        clientRandom,
        t0,
      );
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe("clock_skew");
    });
  });

  describe("Rotating Server Secret Verification", () => {
    it("verifies cookies across secret rotation using previousSecret fallback within sliding window", () => {
      const dtls = new DTLSHandshake();
      const t0 = 1700000000000;

      // Cookie generated with Secret 1
      const cookie1 = dtls.generateStatelessCookie(
        clientIp,
        clientPort,
        clientRandom,
        t0,
      );
      const secret1 = dtls.getCurrentSecret();

      // Secret rotates after 60 seconds (Secret 2 active, Secret 1 stored in previousSecret)
      dtls.rotateServerSecret();
      const secret2 = dtls.getCurrentSecret();
      expect(secret2).not.toBe(secret1);
      expect(dtls.getPreviousSecret()).toBe(secret1);

      // Cookie 1 presented at t0 + 45s (still within 60s sliding window) should succeed via previousSecret
      expect(
        dtls.verifyStatelessCookie(
          cookie1,
          clientIp,
          clientPort,
          clientRandom,
          t0 + 45_000,
        ),
      ).toBe(true);

      // Cookie 2 generated with Secret 2
      const cookie2 = dtls.generateStatelessCookie(
        clientIp,
        clientPort,
        clientRandom,
        t0 + 45_000,
      );
      expect(
        dtls.verifyStatelessCookie(
          cookie2,
          clientIp,
          clientPort,
          clientRandom,
          t0 + 50_000,
        ),
      ).toBe(true);

      // Rotate again (Secret 3 active, Secret 2 in previousSecret, Secret 1 purged)
      dtls.rotateServerSecret();
      expect(dtls.getPreviousSecret()).toBe(secret2);

      // Cookie 1 should now be rejected as Secret 1 is no longer in current or previous secret
      const resultPurged = dtls.validateStatelessCookie(
        cookie1,
        clientIp,
        clientPort,
        clientRandom,
        t0 + 55_000,
      );
      expect(resultPurged.isValid).toBe(false);
      expect(resultPurged.reason).toBe("invalid_signature");
    });
  });

  describe("Tampering & Spoofing Defense", () => {
    it("rejects cookies when client IP is spoofed", () => {
      const dtls = new DTLSHandshake();
      const t0 = 1700000000000;
      const cookie = dtls.generateStatelessCookie(
        clientIp,
        clientPort,
        clientRandom,
        t0,
      );

      const attackerIp = "198.51.100.99";
      const result = dtls.validateStatelessCookie(
        cookie,
        attackerIp,
        clientPort,
        clientRandom,
        t0 + 5_000,
      );

      expect(result.isValid).toBe(false);
      expect(result.reason).toBe("invalid_signature");
    });

    it("rejects cookies when client port is altered", () => {
      const dtls = new DTLSHandshake();
      const t0 = 1700000000000;
      const cookie = dtls.generateStatelessCookie(
        clientIp,
        clientPort,
        clientRandom,
        t0,
      );

      const attackerPort = 12345;
      const result = dtls.validateStatelessCookie(
        cookie,
        clientIp,
        attackerPort,
        clientRandom,
        t0 + 5_000,
      );

      expect(result.isValid).toBe(false);
      expect(result.reason).toBe("invalid_signature");
    });

    it("rejects cookies with forged or modified HMAC signatures", () => {
      const dtls = new DTLSHandshake();
      const t0 = 1700000000000;
      const cookie = dtls.generateStatelessCookie(
        clientIp,
        clientPort,
        clientRandom,
        t0,
      );

      const [ts, sig] = cookie.split(":");
      const forgedSig =
        sig.substring(0, sig.length - 2) + (sig.endsWith("0") ? "1" : "0");
      const tamperedCookie = `${ts}:${forgedSig}`;

      const result = dtls.validateStatelessCookie(
        tamperedCookie,
        clientIp,
        clientPort,
        clientRandom,
        t0 + 5_000,
      );
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe("invalid_signature");
    });

    it("rejects malformed cookie payloads", () => {
      const dtls = new DTLSHandshake();
      expect(
        dtls.validateStatelessCookie("", clientIp, clientPort).isValid,
      ).toBe(false);
      expect(
        dtls.validateStatelessCookie("invalid-no-colon", clientIp, clientPort)
          .isValid,
      ).toBe(false);
      expect(
        dtls.validateStatelessCookie(
          "not-a-number:signature",
          clientIp,
          clientPort,
        ).isValid,
      ).toBe(false);
      expect(
        dtls.validateStatelessCookie("1700000000000:", clientIp, clientPort)
          .isValid,
      ).toBe(false);
    });
  });

  describe("ECDSA Handshake Payloads (Backward Compatibility)", () => {
    it("generates and verifies ECDSA handshake payloads", async () => {
      const peerA = new DTLSHandshake();
      const peerB = new DTLSHandshake();

      // Allow key generation microtasks to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      const payload = await peerA.generateHandshakePayload("session-test-123");
      expect(payload).not.toBeNull();

      const verified = await peerB.verifyHandshakePayload(payload!);
      expect(verified).toBe(true);
      expect(peerB.isPeerVerified("session-test-123")).toBe(true);
    });
  });
});
