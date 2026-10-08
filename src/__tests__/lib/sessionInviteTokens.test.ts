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
});
