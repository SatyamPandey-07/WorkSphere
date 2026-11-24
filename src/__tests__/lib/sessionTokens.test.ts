import {
  IDLE_TIMEOUT_MS,
  WARNING_DURATION_MS,
  rotateRefreshToken,
  generateRefreshToken,
  revokeRefreshTokenFamily,
  _resetTokenFamilyStoreForTesting,
} from "@/lib/auth/sessionTokens";

describe("sessionTokens (Retired)", () => {
  it("exports valid application-level idle and warning timeout constants", () => {
    expect(IDLE_TIMEOUT_MS).toBe(30 * 60 * 1000);
    expect(WARNING_DURATION_MS).toBe(60 * 1000);
  });

  it("returns retired indicator from generateRefreshToken", async () => {
    const token = await generateRefreshToken("user_123");
    expect(token).toBe("custom_refresh_tokens_retired_use_clerk");
  });

  it("returns ENDPOINT_RETIRED error from rotateRefreshToken", async () => {
    const res = await rotateRefreshToken("legacy_token");
    expect(res.code).toBe("ENDPOINT_RETIRED");
    expect(res.error).toContain("retired");
  });

  it("handles revokeRefreshTokenFamily and reset as no-ops without error", async () => {
    await expect(
      revokeRefreshTokenFamily("any_family"),
    ).resolves.toBeUndefined();
    expect(() => _resetTokenFamilyStoreForTesting()).not.toThrow();
  });
});
