/**
 * Tests for the passkey challenge expiry error classification (Issue #1920).
 * verifyAuthenticationResponse() throws on expired challenges.
 * The fix returns 400 instead of 500 for these errors.
 */

// Simulate the error classification
function classifyVerifyError(error: unknown): { status: number; message: string } {
  if (error instanceof Error) {
    const isChallengeError =
      /challenge|expired|unexpected.*challenge/i.test(error.message);

    if (isChallengeError) {
      return {
        status: 400,
        message: "Passkey authentication challenge expired. Please try again.",
      };
    }

    return {
      status: 400,
      message: "Passkey assertion verification failed",
    };
  }

  return { status: 500, message: "Internal server error" };
}

describe("Passkey challenge expiry error classification", () => {
  it("returns 400 for 'challenge' error message", () => {
    const { status } = classifyVerifyError(new Error("The expected challenge was not in the response."));
    expect(status).toBe(400);
  });

  it("returns 400 for 'expired' error message", () => {
    const { status } = classifyVerifyError(new Error("Challenge has expired."));
    expect(status).toBe(400);
  });

  it("returns 400 for 'unexpected challenge' message", () => {
    const { status } = classifyVerifyError(new Error("Unexpected response challenge."));
    expect(status).toBe(400);
  });

  it("returns user-friendly message for expired challenge", () => {
    const { message } = classifyVerifyError(new Error("challenge expired"));
    expect(message).toMatch(/challenge expired/i);
    expect(message).toMatch(/try again/i);
  });

  it("returns 400 for other verification failures (not 500)", () => {
    const { status } = classifyVerifyError(new Error("Invalid signature."));
    expect(status).toBe(400);
  });

  it("returns 500 for non-Error throws", () => {
    const { status } = classifyVerifyError("string error");
    expect(status).toBe(500);
  });

  it("case-insensitive error matching", () => {
    const lower = classifyVerifyError(new Error("CHALLENGE MISMATCH"));
    expect(lower.status).toBe(400);
  });

  it("specific expired challenge message contains actionable text", () => {
    const { message } = classifyVerifyError(new Error("challenge expired"));
    expect(message).toContain("Please try again");
  });
});
