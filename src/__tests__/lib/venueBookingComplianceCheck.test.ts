/**
 * Tests for venue booking compliance checks.
 */

interface ComplianceRequirement {
  requirementId: string;
  name: string;
  type: "age_verification" | "id_check" | "payment_method" | "terms_acceptance" | "capacity_limit";
  mandatory: boolean;
}

interface BookingComplianceStatus {
  bookingId: string;
  userId: string;
  completedRequirements: string[];
  timestamp: number;
}

function checkCompliance(
  requirements: ComplianceRequirement[],
  status: BookingComplianceStatus
): { compliant: boolean; missing: string[]; optional: string[] } {
  const missing: string[] = [];
  const optional: string[] = [];

  for (const req of requirements) {
    if (!status.completedRequirements.includes(req.requirementId)) {
      if (req.mandatory) missing.push(req.name);
      else optional.push(req.name);
    }
  }

  return { compliant: missing.length === 0, missing, optional };
}

function canProceedToPayment(
  requirements: ComplianceRequirement[],
  status: BookingComplianceStatus
): boolean {
  const { compliant } = checkCompliance(requirements, status);
  return compliant;
}

function requirementCompletionRate(
  requirements: ComplianceRequirement[],
  status: BookingComplianceStatus
): number {
  if (requirements.length === 0) return 100;
  const completed = requirements.filter((r) => status.completedRequirements.includes(r.requirementId)).length;
  return Math.round((completed / requirements.length) * 100);
}

function mandatoryRequirements(requirements: ComplianceRequirement[]): ComplianceRequirement[] {
  return requirements.filter((r) => r.mandatory);
}

const REQUIREMENTS: ComplianceRequirement[] = [
  { requirementId: "r1", name: "Terms Acceptance",   type: "terms_acceptance", mandatory: true  },
  { requirementId: "r2", name: "ID Verification",    type: "id_check",         mandatory: true  },
  { requirementId: "r3", name: "Payment Method",     type: "payment_method",   mandatory: true  },
  { requirementId: "r4", name: "Age Verification",   type: "age_verification", mandatory: false },
];

const FULL_STATUS: BookingComplianceStatus = {
  bookingId: "b1", userId: "u1",
  completedRequirements: ["r1", "r2", "r3", "r4"],
  timestamp: 1_700_000_000_000,
};

const PARTIAL_STATUS: BookingComplianceStatus = {
  ...FULL_STATUS, completedRequirements: ["r1", "r3"],
};

describe("Venue booking compliance checks", () => {
  it("checkCompliance: all mandatory met → compliant", () => {
    const { compliant, missing } = checkCompliance(REQUIREMENTS, FULL_STATUS);
    expect(compliant).toBe(true);
    expect(missing).toHaveLength(0);
  });

  it("checkCompliance: missing mandatory ID → not compliant", () => {
    const { compliant, missing } = checkCompliance(REQUIREMENTS, PARTIAL_STATUS);
    expect(compliant).toBe(false);
    expect(missing).toContain("ID Verification");
  });

  it("checkCompliance: optional not completed → in optional list", () => {
    const { optional } = checkCompliance(REQUIREMENTS, PARTIAL_STATUS);
    expect(optional).toContain("Age Verification");
  });

  it("canProceedToPayment: all mandatory complete → true", () => {
    expect(canProceedToPayment(REQUIREMENTS, FULL_STATUS)).toBe(true);
  });

  it("canProceedToPayment: missing mandatory → false", () => {
    expect(canProceedToPayment(REQUIREMENTS, PARTIAL_STATUS)).toBe(false);
  });

  it("requirementCompletionRate: 2/4 = 50%", () => {
    expect(requirementCompletionRate(REQUIREMENTS, PARTIAL_STATUS)).toBe(50);
  });

  it("mandatoryRequirements: 3 mandatory out of 4", () => {
    expect(mandatoryRequirements(REQUIREMENTS)).toHaveLength(3);
  });
});
