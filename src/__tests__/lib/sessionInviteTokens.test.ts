import {
  generateSessionInviteToken,
  validateSessionInviteToken,
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
    expect(result.payload?.sessionId).toBe(sessionId);
    expect(result.payload?.maxParticipants).toBe(10);
  });

  it("rejects expired invite tokens", async () => {
    const sessionId = "session-expired";
    // Generate token with negative duration (-1 hour) to simulate expiration
    const token = await generateSessionInviteToken(sessionId, -1, 10);

    const result = validateSessionInviteToken(token, 2, sessionId);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invite link has expired.");
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
});
