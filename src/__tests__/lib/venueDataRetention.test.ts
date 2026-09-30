/**
 * Tests for venue data retention policy enforcement (GDPR compliance).
 */

type DataCategory = "booking_records" | "user_pii" | "payment_data" | "photos" | "reviews";

interface RetentionPolicy {
  category: DataCategory;
  retentionDays: number;
  legalBasis: string;
  canBeDeleted: boolean;
}

const RETENTION_POLICIES: Record<DataCategory, RetentionPolicy> = {
  booking_records: { category: "booking_records", retentionDays: 7 * 365,  legalBasis: "contract",    canBeDeleted: false },
  user_pii:        { category: "user_pii",        retentionDays: 3 * 365,  legalBasis: "consent",     canBeDeleted: true  },
  payment_data:    { category: "payment_data",     retentionDays: 7 * 365,  legalBasis: "legal_req",   canBeDeleted: false },
  photos:          { category: "photos",           retentionDays: 1 * 365,  legalBasis: "consent",     canBeDeleted: true  },
  reviews:         { category: "reviews",          retentionDays: 5 * 365,  legalBasis: "legitimate",  canBeDeleted: true  },
};

function isRetentionExpired(
  category: DataCategory,
  createdMs: number,
  nowMs: number
): boolean {
  const policy = RETENTION_POLICIES[category];
  const retentionMs = policy.retentionDays * 86_400_000;
  return nowMs - createdMs > retentionMs;
}

function canDeleteRecord(category: DataCategory, createdMs: number, nowMs: number): boolean {
  const policy = RETENTION_POLICIES[category];
  if (!policy.canBeDeleted) return false;
  return isRetentionExpired(category, createdMs, nowMs);
}

function daysUntilExpiry(
  category: DataCategory,
  createdMs: number,
  nowMs: number
): number {
  const policy = RETENTION_POLICIES[category];
  const expiryMs = createdMs + policy.retentionDays * 86_400_000;
  return Math.max(0, Math.ceil((expiryMs - nowMs) / 86_400_000));
}

const NOW = 1_700_000_000_000;
const OLD = NOW - 8 * 365 * 86_400_000; // 8 years ago

describe("Venue data retention policy", () => {
  it("isRetentionExpired: photos after 2 years → expired (1yr policy)", () => {
    const twoYearsAgo = NOW - 2 * 365 * 86_400_000;
    expect(isRetentionExpired("photos", twoYearsAgo, NOW)).toBe(true);
  });

  it("isRetentionExpired: booking records after 3 years → not expired (7yr policy)", () => {
    const threeYearsAgo = NOW - 3 * 365 * 86_400_000;
    expect(isRetentionExpired("booking_records", threeYearsAgo, NOW)).toBe(false);
  });

  it("canDeleteRecord: photos expired and canDelete → true", () => {
    const old = NOW - 2 * 365 * 86_400_000;
    expect(canDeleteRecord("photos", old, NOW)).toBe(true);
  });

  it("canDeleteRecord: payment_data → false (can't delete)", () => {
    expect(canDeleteRecord("payment_data", OLD, NOW)).toBe(false);
  });

  it("canDeleteRecord: user_pii not yet expired → false", () => {
    const recent = NOW - 1 * 365 * 86_400_000;
    expect(canDeleteRecord("user_pii", recent, NOW)).toBe(false);
  });

  it("daysUntilExpiry: fresh photo (1yr policy)", () => {
    expect(daysUntilExpiry("photos", NOW, NOW)).toBe(365);
  });

  it("daysUntilExpiry: expired → 0", () => {
    const old = NOW - 2 * 365 * 86_400_000;
    expect(daysUntilExpiry("photos", old, NOW)).toBe(0);
  });
});
