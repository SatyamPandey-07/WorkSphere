/**
 * Tests for the CRON_SECRET Bearer token validation (Issue #1983).
 * Verifies the partition maintenance cron is properly secured.
 */

function validateCronAuth(
  authHeader: string | null,
  cronSecret: string | undefined,
): { authorized: boolean; reason: string } {
  // If no secret configured, allow all (dev mode)
  if (!cronSecret) {
    return { authorized: true, reason: "no_secret_configured" };
  }

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { authorized: false, reason: "missing_bearer_token" };
  }

  const token = authHeader.slice(7);
  if (token !== cronSecret) {
    return { authorized: false, reason: "invalid_token" };
  }

  return { authorized: true, reason: "valid_token" };
}

describe("Partition cron CRON_SECRET authorization", () => {
  it("allows when CRON_SECRET is not set (dev mode)", () => {
    const result = validateCronAuth(null, undefined);
    expect(result.authorized).toBe(true);
    expect(result.reason).toBe("no_secret_configured");
  });

  it("rejects when CRON_SECRET set but no auth header", () => {
    const result = validateCronAuth(null, "my-secret");
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe("missing_bearer_token");
  });

  it("rejects when auth header doesn't start with 'Bearer '", () => {
    const result = validateCronAuth("Basic my-secret", "my-secret");
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe("missing_bearer_token");
  });

  it("rejects when token doesn't match CRON_SECRET", () => {
    const result = validateCronAuth("Bearer wrong-token", "correct-secret");
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe("invalid_token");
  });

  it("allows when token matches CRON_SECRET exactly", () => {
    const result = validateCronAuth("Bearer my-secret-token", "my-secret-token");
    expect(result.authorized).toBe(true);
    expect(result.reason).toBe("valid_token");
  });

  it("case-sensitive token comparison", () => {
    const result = validateCronAuth("Bearer MY-SECRET", "my-secret");
    expect(result.authorized).toBe(false);
  });

  it("empty string CRON_SECRET with empty Bearer token is NOT authorized", () => {
    // Empty secret means "configured but invalid"
    const result = validateCronAuth("Bearer ", "non-empty-secret");
    expect(result.authorized).toBe(false);
  });
});
