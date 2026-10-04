/**
 * Tests for venue booking dispute escalation policy and triage.
 */

type DisputeType = "overcharge" | "cancellation" | "quality" | "no_show" | "double_booking" | "damage";
type EscalationLevel = "l1_support" | "l2_specialist" | "l3_manager" | "executive";

interface DisputeEscalationPolicy {
  disputeType: DisputeType;
  autoEscalateAfterHours: number;
  maxLevel: EscalationLevel;
  requiresRefund: boolean;
  slaHours: Record<EscalationLevel, number>;
}

const POLICIES: Record<DisputeType, DisputeEscalationPolicy> = {
  overcharge:       { disputeType: "overcharge",       autoEscalateAfterHours: 48,  maxLevel: "l2_specialist", requiresRefund: true,  slaHours: { l1_support: 24, l2_specialist: 48, l3_manager: 72,  executive: 120 } },
  cancellation:     { disputeType: "cancellation",     autoEscalateAfterHours: 24,  maxLevel: "l2_specialist", requiresRefund: true,  slaHours: { l1_support: 12, l2_specialist: 24, l3_manager: 48,  executive: 96 } },
  quality:          { disputeType: "quality",          autoEscalateAfterHours: 72,  maxLevel: "l3_manager",    requiresRefund: false, slaHours: { l1_support: 48, l2_specialist: 72, l3_manager: 120, executive: 168 } },
  no_show:          { disputeType: "no_show",          autoEscalateAfterHours: 24,  maxLevel: "l2_specialist", requiresRefund: false, slaHours: { l1_support: 24, l2_specialist: 48, l3_manager: 72,  executive: 120 } },
  double_booking:   { disputeType: "double_booking",   autoEscalateAfterHours: 12,  maxLevel: "l3_manager",    requiresRefund: true,  slaHours: { l1_support: 8,  l2_specialist: 24, l3_manager: 48,  executive: 72 } },
  damage:           { disputeType: "damage",           autoEscalateAfterHours: 96,  maxLevel: "executive",     requiresRefund: false, slaHours: { l1_support: 72, l2_specialist: 96, l3_manager: 168, executive: 240 } },
};

function slaForLevel(type: DisputeType, level: EscalationLevel): number {
  return POLICIES[type].slaHours[level];
}

function shouldAutoEscalate(type: DisputeType, openHours: number): boolean {
  return openHours >= POLICIES[type].autoEscalateAfterHours;
}

function requiresRefund(type: DisputeType): boolean {
  return POLICIES[type].requiresRefund;
}

function maxEscalationLevel(type: DisputeType): EscalationLevel {
  return POLICIES[type].maxLevel;
}

function urgentDisputeTypes(maxSlaHours = 24): DisputeType[] {
  return (Object.values(POLICIES) as DisputeEscalationPolicy[])
    .filter((p) => p.slaHours.l1_support <= maxSlaHours)
    .map((p) => p.disputeType);
}

describe("Dispute escalation policy and triage", () => {
  it("slaForLevel: double_booking L1 = 8h", () => {
    expect(slaForLevel("double_booking", "l1_support")).toBe(8);
  });

  it("shouldAutoEscalate: overcharge at 50h → true", () => {
    expect(shouldAutoEscalate("overcharge", 50)).toBe(true);
  });

  it("shouldAutoEscalate: quality at 24h → false (needs 72h)", () => {
    expect(shouldAutoEscalate("quality", 24)).toBe(false);
  });

  it("requiresRefund: cancellation → true", () => {
    expect(requiresRefund("cancellation")).toBe(true);
  });

  it("requiresRefund: quality → false", () => {
    expect(requiresRefund("quality")).toBe(false);
  });

  it("urgentDisputeTypes: cancellation and double_booking within 24h SLA", () => {
    const urgent = urgentDisputeTypes(24);
    expect(urgent).toContain("double_booking");
    expect(urgent).toContain("cancellation");
  });
});
