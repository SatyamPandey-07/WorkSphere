/**
 * Tests for GDPR consent management for venue booking platform.
 */

type ConsentPurpose = "analytics" | "marketing" | "personalization" | "third_party_sharing" | "cookies";
type ConsentStatus = "granted" | "denied" | "withdrawn" | "pending";

interface Consent {
  userId: string;
  purpose: ConsentPurpose;
  status: ConsentStatus;
  grantedAt: number | null;
  withdrawnAt: number | null;
  ipAddress: string;
  version: string;
}

interface ConsentAudit {
  userId: string;
  purpose: ConsentPurpose;
  action: "granted" | "denied" | "withdrawn";
  timestamp: number;
  ipAddress: string;
}

function hasActiveConsent(consent: Consent): boolean {
  return consent.status === "granted" && consent.grantedAt !== null;
}

function consentForPurpose(consents: Consent[], userId: string, purpose: ConsentPurpose): boolean {
  const found = consents.find((c) => c.userId === userId && c.purpose === purpose);
  return found ? hasActiveConsent(found) : false;
}

function withdrawnConsents(consents: Consent[], userId: string): Consent[] {
  return consents.filter((c) => c.userId === userId && c.status === "withdrawn");
}

function activeConsentCount(consents: Consent[], userId: string): number {
  return consents.filter((c) => c.userId === userId && hasActiveConsent(c)).length;
}

function createWithdrawal(consent: Consent, nowMs: number): Consent {
  return {
    ...consent,
    status: "withdrawn",
    withdrawnAt: nowMs,
  };
}

function consentAgeMs(consent: Consent, nowMs: number): number | null {
  if (!consent.grantedAt) return null;
  return nowMs - consent.grantedAt;
}

const NOW = 1_700_000_000_000;
const CONSENTS: Consent[] = [
  { userId: "u1", purpose: "analytics",    status: "granted",   grantedAt: NOW - 30 * 86_400_000, withdrawnAt: null,              ipAddress: "1.2.3.4", version: "v2" },
  { userId: "u1", purpose: "marketing",    status: "denied",    grantedAt: null,                  withdrawnAt: null,              ipAddress: "1.2.3.4", version: "v2" },
  { userId: "u1", purpose: "cookies",      status: "withdrawn", grantedAt: NOW - 60 * 86_400_000, withdrawnAt: NOW - 5 * 86_400_000, ipAddress: "1.2.3.4", version: "v2" },
];

describe("GDPR consent management", () => {
  it("hasActiveConsent: granted with date → true", () => {
    expect(hasActiveConsent(CONSENTS[0])).toBe(true);
  });

  it("hasActiveConsent: denied → false", () => {
    expect(hasActiveConsent(CONSENTS[1])).toBe(false);
  });

  it("consentForPurpose: u1 has analytics consent", () => {
    expect(consentForPurpose(CONSENTS, "u1", "analytics")).toBe(true);
  });

  it("consentForPurpose: u1 no marketing consent", () => {
    expect(consentForPurpose(CONSENTS, "u1", "marketing")).toBe(false);
  });

  it("activeConsentCount: 1 active consent for u1", () => {
    expect(activeConsentCount(CONSENTS, "u1")).toBe(1);
  });

  it("withdrawnConsents: 1 withdrawn consent", () => {
    expect(withdrawnConsents(CONSENTS, "u1").length).toBe(1);
  });

  it("consentAgeMs: analytics granted 30 days ago", () => {
    const age = consentAgeMs(CONSENTS[0], NOW);
    expect(age).toBe(30 * 86_400_000);
  });
});
