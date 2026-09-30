/**
 * Tests for venue sustainability certification assessment.
 */

type CertificationBody = "LEED" | "BREEAM" | "WELL" | "ISO14001" | "energy_star";

interface SustainabilityCertification {
  certId: string;
  venueId: string;
  body: CertificationBody;
  level: "certified" | "silver" | "gold" | "platinum";
  issueDate: string;
  expiryDate: string;
  score: number;          // 0-100
}

const CERT_WEIGHTS: Record<CertificationBody, number> = {
  LEED: 10, BREEAM: 9, WELL: 8, ISO14001: 7, energy_star: 6,
};

function isCertificationValid(cert: SustainabilityCertification, todayStr: string): boolean {
  return todayStr <= cert.expiryDate;
}

function sustainabilityImpactScore(certifications: SustainabilityCertification[], venueId: string, todayStr: string): number {
  const valid = certifications.filter((c) => c.venueId === venueId && isCertificationValid(c, todayStr));
  if (valid.length === 0) return 0;
  return Math.round(
    valid.reduce((sum, c) => sum + c.score * (CERT_WEIGHTS[c.body] / 10), 0) / valid.length
  );
}

function hasPlatinumLevel(certifications: SustainabilityCertification[], venueId: string, todayStr: string): boolean {
  return certifications.some(
    (c) => c.venueId === venueId && c.level === "platinum" && isCertificationValid(c, todayStr)
  );
}

function certificationCount(certifications: SustainabilityCertification[], venueId: string, todayStr: string): number {
  return certifications.filter((c) => c.venueId === venueId && isCertificationValid(c, todayStr)).length;
}

function expiringCertifications(
  certifications: SustainabilityCertification[],
  venueId: string,
  todayStr: string,
  warningDays = 90
): SustainabilityCertification[] {
  const warning = new Date(todayStr);
  warning.setDate(warning.getDate() + warningDays);
  const warningStr = warning.toISOString().split("T")[0];
  return certifications.filter(
    (c) => c.venueId === venueId && isCertificationValid(c, todayStr) && c.expiryDate <= warningStr
  );
}

const CERTS: SustainabilityCertification[] = [
  { certId: "c1", venueId: "v1", body: "LEED",     level: "gold",     issueDate: "2024-01-01", expiryDate: "2027-01-01", score: 85 },
  { certId: "c2", venueId: "v1", body: "WELL",     level: "platinum", issueDate: "2024-06-01", expiryDate: "2026-06-01", score: 90 },
  { certId: "c3", venueId: "v1", body: "ISO14001", level: "certified",issueDate: "2023-01-01", expiryDate: "2025-12-31", score: 70 },
  { certId: "c4", venueId: "v2", body: "BREEAM",   level: "gold",     issueDate: "2024-01-01", expiryDate: "2027-01-01", score: 80 },
];

describe("Venue sustainability certification", () => {
  const TODAY = "2026-01-01";

  it("isCertificationValid: within expiry → true", () => {
    expect(isCertificationValid(CERTS[0], TODAY)).toBe(true);
  });

  it("isCertificationValid: expired → false", () => {
    expect(isCertificationValid(CERTS[2], "2026-01-01")).toBe(false);
  });

  it("certificationCount: v1 has 2 valid (c3 expired)", () => {
    expect(certificationCount(CERTS, "v1", TODAY)).toBe(2);
  });

  it("hasPlatinumLevel: v1 has WELL platinum → true", () => {
    expect(hasPlatinumLevel(CERTS, "v1", TODAY)).toBe(true);
  });

  it("hasPlatinumLevel: v2 no platinum → false", () => {
    expect(hasPlatinumLevel(CERTS, "v2", TODAY)).toBe(false);
  });

  it("sustainabilityImpactScore: v1 weighted average", () => {
    expect(sustainabilityImpactScore(CERTS, "v1", TODAY)).toBeGreaterThan(0);
  });

  it("expiringCertifications: c2 expires Jun 2026 within 90 days of April 2026", () => {
    const expiring = expiringCertifications(CERTS, "v1", "2026-04-01");
    expect(expiring.some((c) => c.certId === "c2")).toBe(true);
  });
});
