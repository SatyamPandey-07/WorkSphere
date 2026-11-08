import {
  getKeyExpiryDate,
  isKeyExpired,
  daysUntilExpiry,
  shouldPromptRotation,
} from "@/lib/auth/passkeys/server/verifyAttestation";
import { KEY_EXPIRY_DAYS } from "@/lib/auth/passkeys/types";

describe("Passkey Expiry and Rotation Schedule Calculation", () => {
  describe("getKeyExpiryDate", () => {
    it("calculates expiry date precisely 90 days after creation", () => {
      const createdAt = new Date("2026-01-01T00:00:00.000Z");
      const expiresAt = getKeyExpiryDate(createdAt);

      const diffMs = expiresAt.getTime() - createdAt.getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

      expect(diffDays).toBe(KEY_EXPIRY_DAYS);
      expect(KEY_EXPIRY_DAYS).toBe(90);
    });

    it("correctly handles leap year dates", () => {
      // 2028 is a leap year (Feb has 29 days)
      const leapYearStart = new Date("2028-02-01T00:00:00.000Z");
      const expiresAt = getKeyExpiryDate(leapYearStart);

      const diffMs = expiresAt.getTime() - leapYearStart.getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

      expect(diffDays).toBe(90);
      expect(expiresAt.toISOString()).toBe("2028-05-01T00:00:00.000Z");
    });
  });

  describe("isKeyExpired", () => {
    const expiresAt = new Date("2026-06-01T12:00:00.000Z");

    it("returns false when reference date is before expiry", () => {
      const before = new Date("2026-05-30T12:00:00.000Z");
      expect(isKeyExpired(expiresAt, before)).toBe(false);
    });

    it("returns false when reference date is equal to expiry", () => {
      const exact = new Date("2026-06-01T12:00:00.000Z");
      expect(isKeyExpired(expiresAt, exact)).toBe(false);
    });

    it("returns true when reference date is after expiry", () => {
      const after = new Date("2026-06-01T12:00:01.000Z");
      expect(isKeyExpired(expiresAt, after)).toBe(true);
    });
  });

  describe("daysUntilExpiry", () => {
    const expiresAt = new Date("2026-06-15T00:00:00.000Z");

    it("calculates remaining whole days accurately", () => {
      expect(daysUntilExpiry(expiresAt, new Date("2026-06-01T00:00:00.000Z"))).toBe(14);
      expect(daysUntilExpiry(expiresAt, new Date("2026-06-14T00:00:00.000Z"))).toBe(1);
      expect(daysUntilExpiry(expiresAt, new Date("2026-06-15T00:00:00.000Z"))).toBe(0);
      expect(daysUntilExpiry(expiresAt, new Date("2026-06-16T00:00:00.000Z"))).toBe(-1);
    });

    it("handles daylight saving time boundary shifts cleanly", () => {
      // March DST spring forward shift in US
      const dstExpiry = new Date("2026-03-20T00:00:00.000Z");
      const preDstDate = new Date("2026-03-06T00:00:00.000Z"); // 14 days before

      expect(daysUntilExpiry(dstExpiry, preDstDate)).toBe(14);
    });
  });

  describe("shouldPromptRotation", () => {
    const expiresAt = new Date("2026-06-15T00:00:00.000Z");

    it("returns false at 15 days before expiry (outside 14-day rotation window)", () => {
      const refDate = new Date("2026-05-31T00:00:00.000Z"); // 15 days remaining
      expect(shouldPromptRotation(expiresAt, refDate)).toBe(false);
    });

    it("returns true at 14 days before expiry (start of rotation prompt window)", () => {
      const refDate = new Date("2026-06-01T00:00:00.000Z"); // exactly 14 days
      expect(shouldPromptRotation(expiresAt, refDate)).toBe(true);
    });

    it("returns true at 7 days and 1 day before expiry", () => {
      const refDate7 = new Date("2026-06-08T00:00:00.000Z"); // 7 days
      const refDate1 = new Date("2026-06-14T00:00:00.000Z"); // 1 day
      expect(shouldPromptRotation(expiresAt, refDate7)).toBe(true);
      expect(shouldPromptRotation(expiresAt, refDate1)).toBe(true);
    });

    it("returns false on expiry day (0 days) and post-expiry (-1 days)", () => {
      const refDate0 = new Date("2026-06-15T00:00:00.000Z"); // 0 days
      const refDateExpired = new Date("2026-06-16T00:00:00.000Z"); // -1 day
      expect(shouldPromptRotation(expiresAt, refDate0)).toBe(false);
      expect(shouldPromptRotation(expiresAt, refDateExpired)).toBe(false);
    });
  });
});
