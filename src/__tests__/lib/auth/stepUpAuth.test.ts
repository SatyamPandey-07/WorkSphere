import {
  issueStepUpToken,
  verifyStepUpToken,
} from "@/lib/auth/stepUpAuth";

describe("Step-Up Re-Authentication Token Manager", () => {
  const USER_ID = "user_test_stepup_123";
  const ACTION = "revoke_credential";
  const CREDENTIAL_ID = "cred_webauthn_abc_999";

  it("issues a valid HMAC-signed step-up token and verifies it successfully", () => {
    const token = issueStepUpToken(USER_ID, ACTION, CREDENTIAL_ID, true);
    expect(typeof token).toBe("string");
    expect(token).toContain(".");

    const result = verifyStepUpToken(token, ACTION, USER_ID);
    expect(result.valid).toBe(true);
    expect(result.userId).toBe(USER_ID);
    expect(result.action).toBe(ACTION);
    expect(result.userVerified).toBe(true);
    expect(result.timeRemainingSeconds).toBeGreaterThan(0);
  });

  it("rejects token when userVerified is false", () => {
    const unverifiedToken = issueStepUpToken(USER_ID, ACTION, CREDENTIAL_ID, false);
    const result = verifyStepUpToken(unverifiedToken, ACTION, USER_ID);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("biometric user verification");
  });

  it("rejects token on action mismatch", () => {
    const token = issueStepUpToken(USER_ID, "delete_account", CREDENTIAL_ID, true);
    const result = verifyStepUpToken(token, "transfer_ownership", USER_ID);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("action mismatch");
  });

  it("rejects token on user ID mismatch", () => {
    const token = issueStepUpToken(USER_ID, ACTION, CREDENTIAL_ID, true);
    const result = verifyStepUpToken(token, ACTION, "attacker_user_id");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("does not match active user session");
  });

  it("rejects tampered signature", () => {
    const token = issueStepUpToken(USER_ID, ACTION, CREDENTIAL_ID, true);
    const [payload, sig] = token.split(".");
    const tampered = `${payload}.${sig.slice(0, -4)}abcd`;

    const result = verifyStepUpToken(tampered, ACTION, USER_ID);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("signature verification failed");
  });

  it("rejects malformed tokens", () => {
    expect(verifyStepUpToken("").valid).toBe(false);
    expect(verifyStepUpToken("not-a-token").valid).toBe(false);
  });
});
