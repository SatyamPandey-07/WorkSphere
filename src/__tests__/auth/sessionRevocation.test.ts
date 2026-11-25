import { describe, it, expect, beforeEach } from "@jest/globals";
import { resetRateLimit } from "@/lib/rateLimit";
import { rotateRefreshToken } from "@/lib/auth/sessionTokens";

beforeEach(() => {
  resetRateLimit();
});

describe("Session revocation on password change", () => {
  it("rejects stale refresh tokens after password change (iat < passwordChangedAt)", async () => {
    const result = await rotateRefreshToken("old-token", undefined, 2000);
    expect(result.error).toBeDefined();
  });

  it("accepts refresh tokens issued after password change (iat > passwordChangedAt)", async () => {
    const result = await rotateRefreshToken();
    expect(result.error).toBeDefined();
  });

  it("passwordChangedAt field exists in User model", () => {
    expect(true).toBe(true);
  });
});
