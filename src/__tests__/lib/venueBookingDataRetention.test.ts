/**
 * Tests for venue booking data retention policy enforcement.
 */

type DataCategory = "booking" | "payment" | "user_profile" | "analytics" | "audit_log" | "marketing";

interface RetentionPolicy {
  category: DataCategory;
  retentionDays: number;
  canBeAnonymised: boolean;
  legalBasis: "contract" | "legitimate_interest" | "consent" | "legal_obligation";
}

interface DataRecord {
  id: string;
  category: DataCategory;
  createdAt: number;
  lastAccessedAt: number;
  userId: string;
  isAnonymised: boolean;
}

const POLICIES: Record<DataCategory, RetentionPolicy> = {
  booking:      { category: "booking",      retentionDays: 2555, canBeAnonymised: false, legalBasis: "contract" },           // 7 years
  payment:      { category: "payment",      retentionDays: 2555, canBeAnonymised: false, legalBasis: "legal_obligation" },   // 7 years
  user_profile: { category: "user_profile", retentionDays: 365,  canBeAnonymised: true,  legalBasis: "consent" },
  analytics:    { category: "analytics",    retentionDays: 90,   canBeAnonymised: true,  legalBasis: "legitimate_interest" },
  audit_log:    { category: "audit_log",    retentionDays: 1825, canBeAnonymised: false, legalBasis: "legal_obligation" },   // 5 years
  marketing:    { category: "marketing",    retentionDays: 180,  canBeAnonymised: true,  legalBasis: "consent" },
};

function isExpired(record: DataRecord, nowMs: number): boolean {
  const policy = POLICIES[record.category];
  const ageMs = nowMs - record.createdAt;
  return ageMs > policy.retentionDays * 86_400_000;
}

function shouldAnonymise(record: DataRecord, nowMs: number): boolean {
  return isExpired(record) && POLICIES[record.category].canBeAnonymised && !record.isAnonymised;
}

function expiredRecords(records: DataRecord[], nowMs: number): DataRecord[] {
  return records.filter((r) => isExpired(r, nowMs));
}

function retentionDaysRemaining(record: DataRecord, nowMs: number): number {
  const policy = POLICIES[record.category];
  const ageMs = nowMs - record.createdAt;
  const remaining = policy.retentionDays * 86_400_000 - ageMs;
  return Math.max(0, Math.floor(remaining / 86_400_000));
}

const NOW = 1_700_000_000_000;
const RECORDS: DataRecord[] = [
  { id: "d1", category: "analytics",    createdAt: NOW - 100 * 86_400_000, lastAccessedAt: NOW, userId: "u1", isAnonymised: false },
  { id: "d2", category: "user_profile", createdAt: NOW - 400 * 86_400_000, lastAccessedAt: NOW, userId: "u2", isAnonymised: false },
  { id: "d3", category: "booking",      createdAt: NOW - 10  * 86_400_000, lastAccessedAt: NOW, userId: "u3", isAnonymised: false },
];

describe("Data retention policy enforcement", () => {
  it("isExpired: analytics record 100d old (policy 90d) → expired", () => {
    expect(isExpired(RECORDS[0], NOW)).toBe(true);
  });

  it("isExpired: booking record 10d old (policy 2555d) → not expired", () => {
    expect(isExpired(RECORDS[2], NOW)).toBe(false);
  });

  it("shouldAnonymise: expired analytics can be anonymised", () => {
    expect(shouldAnonymise(RECORDS[0], NOW)).toBe(true);
  });

  it("expiredRecords: d1 and d2 are expired", () => {
    const expired = expiredRecords(RECORDS, NOW);
    expect(expired.length).toBe(2);
  });

  it("retentionDaysRemaining: booking 10d used, 2545 left", () => {
    expect(retentionDaysRemaining(RECORDS[2], NOW)).toBe(2545);
  });

  it("retentionDaysRemaining: expired record → 0", () => {
    expect(retentionDaysRemaining(RECORDS[0], NOW)).toBe(0);
  });
});
