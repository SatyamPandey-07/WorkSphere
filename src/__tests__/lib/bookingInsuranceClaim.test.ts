/**
 * Tests for booking damage/incident insurance claim processing.
 */

type ClaimStatus = "submitted" | "under_review" | "approved" | "denied" | "paid";
type ClaimCategory = "damage" | "theft" | "injury" | "cancellation";

interface InsuranceClaim {
  claimId: string;
  bookingId: string;
  userId: string;
  category: ClaimCategory;
  claimedAmountCents: number;
  approvedAmountCents: number | null;
  status: ClaimStatus;
  submittedAt: number;
  resolvedAt: number | null;
  evidenceUrls: string[];
}

function canSubmitClaim(
  claim: Partial<InsuranceClaim>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!claim.bookingId) errors.push("bookingId required");
  if (!claim.category) errors.push("category required");
  if (!claim.claimedAmountCents || claim.claimedAmountCents <= 0) errors.push("amount must be positive");
  if (!claim.evidenceUrls || claim.evidenceUrls.length === 0) errors.push("at least one evidence required");
  return { valid: errors.length === 0, errors };
}

function approveClaim(
  claim: InsuranceClaim,
  approvedAmount: number,
  nowMs: number
): InsuranceClaim {
  if (claim.status !== "under_review") throw new Error("Claim must be under review to approve");
  return { ...claim, status: "approved", approvedAmountCents: approvedAmount, resolvedAt: nowMs };
}

function denyClaim(claim: InsuranceClaim, nowMs: number): InsuranceClaim {
  if (claim.status !== "under_review") throw new Error("Claim must be under review to deny");
  return { ...claim, status: "denied", approvedAmountCents: 0, resolvedAt: nowMs };
}

function claimResolutionDays(claim: InsuranceClaim): number | null {
  if (!claim.resolvedAt) return null;
  return Math.floor((claim.resolvedAt - claim.submittedAt) / 86_400_000);
}

const NOW = 1_700_000_000_000;
const CLAIM: InsuranceClaim = {
  claimId: "cl1", bookingId: "b1", userId: "u1",
  category: "damage", claimedAmountCents: 5000, approvedAmountCents: null,
  status: "under_review", submittedAt: NOW - 3 * 86_400_000, resolvedAt: null,
  evidenceUrls: ["photo1.jpg"],
};

describe("Booking insurance claim processing", () => {
  it("canSubmitClaim: valid claim → no errors", () => {
    const { valid } = canSubmitClaim({ bookingId: "b1", category: "damage", claimedAmountCents: 5000, evidenceUrls: ["p.jpg"] });
    expect(valid).toBe(true);
  });

  it("canSubmitClaim: missing evidence → error", () => {
    const { errors } = canSubmitClaim({ bookingId: "b1", category: "theft", claimedAmountCents: 1000, evidenceUrls: [] });
    expect(errors.some((e) => /evidence/i.test(e))).toBe(true);
  });

  it("canSubmitClaim: zero amount → error", () => {
    const { errors } = canSubmitClaim({ bookingId: "b1", category: "damage", claimedAmountCents: 0, evidenceUrls: ["p.jpg"] });
    expect(errors.some((e) => /amount/i.test(e))).toBe(true);
  });

  it("approveClaim: sets status to approved", () => {
    const approved = approveClaim(CLAIM, 4000, NOW);
    expect(approved.status).toBe("approved");
    expect(approved.approvedAmountCents).toBe(4000);
  });

  it("approveClaim: throws if not under_review", () => {
    const submitted = { ...CLAIM, status: "submitted" as ClaimStatus };
    expect(() => approveClaim(submitted, 4000, NOW)).toThrow("under review");
  });

  it("denyClaim: sets status to denied with 0 approved", () => {
    const denied = denyClaim(CLAIM, NOW);
    expect(denied.status).toBe("denied");
    expect(denied.approvedAmountCents).toBe(0);
  });

  it("claimResolutionDays: 3 days for resolved claim", () => {
    const approved = approveClaim(CLAIM, 4000, NOW);
    expect(claimResolutionDays(approved)).toBe(3);
  });

  it("claimResolutionDays: null for pending claim", () => {
    expect(claimResolutionDays(CLAIM)).toBeNull();
  });
});
