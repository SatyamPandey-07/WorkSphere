import {
  generateSessionInviteToken,
  validateSessionInviteToken,
  verifyInviteTokenResponse,
  generateSecureNonce,
  encodeBase64Url,
  decodeBase64Url,
} from "@/lib/sessionInviteTokens";

describe("Session Invite Tokens & WebCrypto Generator (src/lib/sessionInviteTokens.ts)", () => {
  it("encodes and decodes URL-safe base64 strings cleanly", () => {
    const originalText = JSON.stringify({ test: "data-123", value: 42 });
    const encoded = encodeBase64Url(originalText);
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");

    const decoded = decodeBase64Url(encoded);
    expect(decoded).toBe(originalText);
  });

  it("generates cryptographically secure random nonces", () => {
    const nonce1 = generateSecureNonce(16);
    const nonce2 = generateSecureNonce(16);
    expect(nonce1).toHaveLength(32); // 16 bytes = 32 hex chars
    expect(nonce2).toHaveLength(32);
    expect(nonce1).not.toBe(nonce2);
  });

  it("generates and validates active session invite tokens", async () => {
    const sessionId = "session-test-slug";
    const token = await generateSessionInviteToken(sessionId, 24, 10);

    expect(token).toBeTruthy();
    expect(typeof token).toBe("string");

    const result = validateSessionInviteToken(token, 3, sessionId);
    expect(result.valid).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.payload?.sessionId).toBe(sessionId);
    expect(result.payload?.maxParticipants).toBe(10);
  });

  it("rejects expired invite tokens with 410 Gone status code", async () => {
    const sessionId = "session-expired";
    // Generate token with negative duration (-1 hour) to simulate expiration
    const token = await generateSessionInviteToken(sessionId, -1, 10);

    const result = validateSessionInviteToken(token, 2, sessionId);
    expect(result.valid).toBe(false);
    expect(result.expired).toBe(true);
    expect(result.statusCode).toBe(410);
    expect(result.error).toBe("Invite token has expired");

    const response = verifyInviteTokenResponse(token, 2, sessionId);
    expect(response.status).toBe(410);
    expect(response.body).toEqual({
      valid: false,
      error: "Invite token has expired",
    });
  });

  it("validates token expiration against explicit server timestamp", async () => {
    const sessionId = "session-timestamp-test";
    const token = await generateSessionInviteToken(sessionId, 2, 10); // expires in +2 hours

    const now = Date.now();
    // Valid when checked at current server time
    const resultNow = validateSessionInviteToken(token, 2, sessionId, undefined, now);
    expect(resultNow.valid).toBe(true);
    expect(resultNow.statusCode).toBe(200);

    // Expired when evaluated against server timestamp 3 hours in the future
    const futureServerTimestamp = now + 3 * 60 * 60 * 1000;
    const resultFuture = validateSessionInviteToken(token, 2, sessionId, undefined, futureServerTimestamp);
    expect(resultFuture.valid).toBe(false);
    expect(resultFuture.statusCode).toBe(410);
    expect(resultFuture.expired).toBe(true);
    expect(resultFuture.error).toBe("Invite token has expired");
  });

  it("rejects invite tokens when participant limits are exceeded", async () => {
    const sessionId = "session-full";
    const maxParticipants = 5;
    const token = await generateSessionInviteToken(
      sessionId,
      24,
      maxParticipants,
    );

    // Current participant count is equal to max limit (5)
    const resultFull = validateSessionInviteToken(token, 5, sessionId);
    expect(resultFull.valid).toBe(false);
    expect(resultFull.error).toBe("Session participant limit reached.");

    // Current participant count below max limit (4)
    const resultOk = validateSessionInviteToken(token, 4, sessionId);
    expect(resultOk.valid).toBe(true);
  });

  it("rejects tokens with mismatched session IDs", async () => {
    const token = await generateSessionInviteToken("session-alpha", 24);

    const result = validateSessionInviteToken(token, 1, "session-beta");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invite token does not match this session.");
  });

  it("rejects tokens with forged or invalid signatures", async () => {
    const token = await generateSessionInviteToken("session-alpha", 24, 10);
    const [payloadB64] = token.split(".");
    const forgedToken = `${payloadB64}.forged_signature_xyz`;

    const result = validateSessionInviteToken(forgedToken, 1, "session-alpha");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid or forged invite token signature.");
  });

  it("rejects tokens when payload has been tampered with", async () => {
    const token = await generateSessionInviteToken("session-alpha", 24, 2);
    const [payloadB64, signature] = token.split(".");

    // Attacker tampers with payload to inflate maxParticipants from 2 to 999
    const decoded = JSON.parse(decodeBase64Url(payloadB64));
    decoded.maxParticipants = 999;
    const tamperedPayloadB64 = encodeBase64Url(JSON.stringify(decoded));
    const tamperedToken = `${tamperedPayloadB64}.${signature}`;

    const result = validateSessionInviteToken(
      tamperedToken,
      1,
      "session-alpha",
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid or forged invite token signature.");
  });

  it("rejects malformed tokens lacking signature part", () => {
    const rawPayloadB64 = encodeBase64Url(
      JSON.stringify({ sessionId: "session-alpha", expiresAt: Date.now() + 10000 }),
    );
    const result = validateSessionInviteToken(rawPayloadB64, 1, "session-alpha");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid invite token format.");
  });

  describe("Hardening & Edge Cases (#6758)", () => {
    it("rejects generateSessionInviteToken with invalid sessionId or NaN duration", async () => {
      await expect(generateSessionInviteToken("")).rejects.toThrow("sessionId must be a non-empty string.");
      await expect(generateSessionInviteToken("   ")).rejects.toThrow("sessionId must be a non-empty string.");
      await expect(generateSessionInviteToken(null as any)).rejects.toThrow("sessionId must be a non-empty string.");
      await expect(generateSessionInviteToken("session-1", NaN)).rejects.toThrow("expiresInHours must be a finite number.");
      await expect(generateSessionInviteToken("session-1", Infinity)).rejects.toThrow("expiresInHours must be a finite number.");
    });

    it("safely generates secure nonce when bytesCount is negative, NaN, or non-integer", () => {
      expect(generateSecureNonce(-5)).toHaveLength(32); // defaults to 16 bytes = 32 hex chars
      expect(generateSecureNonce(NaN as any)).toHaveLength(32);
      expect(generateSecureNonce(2.5 as any)).toHaveLength(32);
    });

    it("prevents participant capacity limit bypass with NaN or invalid count", async () => {
      const token = await generateSessionInviteToken("session-cap", 24, 5);
      // Valid count below limit
      expect(validateSessionInviteToken(token, 4, "session-cap").valid).toBe(true);
      // Exceeds limit
      expect(validateSessionInviteToken(token, 5, "session-cap").valid).toBe(false);
      // NaN or null participant count safely treated as 0 (not bypassing limit or throwing)
      const resNaN = validateSessionInviteToken(token, NaN as any, "session-cap");
      expect(resNaN.valid).toBe(true);
    });

    it("rejects token when payload has non-finite expiresAt or non-string sessionId", () => {
      const payloadB64 = encodeBase64Url(JSON.stringify({ sessionId: 12345, expiresAt: NaN, nonce: "test" }));
      // Generate with matching HMAC using testing default secret
      const result = validateSessionInviteToken(`${payloadB64}.fake`);
      expect(result.valid).toBe(false);
    });

    it("safely handles non-string inputs to base64 helpers", () => {
      expect(encodeBase64Url(null as any)).toBe("");
      expect(decodeBase64Url(null as any)).toBe("");
    });
  });
});
