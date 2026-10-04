/**
 * Tests for venue booking service level agreement (SLA) management.
 */

type SlaMetric = "response_time" | "resolution_time" | "uptime" | "booking_confirmation";

interface SlaTarget {
  metric: SlaMetric;
  targetValue: number;
  unit: "hours" | "minutes" | "percent";
  criticalThreshold: number;
}

interface SlaRecord {
  period: string;          // YYYY-MM
  metric: SlaMetric;
  actualValue: number;
  targetValue: number;
  breachCount: number;
  totalMeasurements: number;
}

const SLA_TARGETS: Record<SlaMetric, SlaTarget> = {
  response_time:        { metric: "response_time",        targetValue: 4,   unit: "hours",   criticalThreshold: 24 },
  resolution_time:      { metric: "resolution_time",      targetValue: 48,  unit: "hours",   criticalThreshold: 120 },
  uptime:               { metric: "uptime",               targetValue: 99.9,unit: "percent", criticalThreshold: 99 },
  booking_confirmation: { metric: "booking_confirmation", targetValue: 30,  unit: "minutes", criticalThreshold: 120 },
};

function isMeetingSla(record: SlaRecord): boolean {
  const target = SLA_TARGETS[record.metric];
  if (target.unit === "percent") return record.actualValue >= record.targetValue;
  return record.actualValue <= record.targetValue;
}

function isCritical(record: SlaRecord): boolean {
  const target = SLA_TARGETS[record.metric];
  if (target.unit === "percent") return record.actualValue < target.criticalThreshold;
  return record.actualValue > target.criticalThreshold;
}

function breachRate(record: SlaRecord): number {
  if (record.totalMeasurements === 0) return 0;
  return Math.round((record.breachCount / record.totalMeasurements) * 100);
}

function complianceRate(record: SlaRecord): number {
  return 100 - breachRate(record);
}

function overallSlaHealth(records: SlaRecord[]): "healthy" | "at_risk" | "critical" {
  const criticals = records.filter(isCritical);
  const breaching = records.filter((r) => !isMeetingSla(r));
  if (criticals.length > 0) return "critical";
  if (breaching.length > 0) return "at_risk";
  return "healthy";
}

const RECORDS: SlaRecord[] = [
  { period: "2026-09", metric: "response_time",        actualValue: 3.5,  targetValue: 4,    breachCount: 5,  totalMeasurements: 100 },
  { period: "2026-09", metric: "uptime",               actualValue: 99.8, targetValue: 99.9, breachCount: 2,  totalMeasurements: 1000 },
  { period: "2026-09", metric: "booking_confirmation", actualValue: 45,   targetValue: 30,   breachCount: 20, totalMeasurements: 200 },
];

describe("SLA management", () => {
  it("isMeetingSla: response_time 3.5h ≤ 4h → true", () => {
    expect(isMeetingSla(RECORDS[0])).toBe(true);
  });

  it("isMeetingSla: uptime 99.8 < 99.9 → false", () => {
    expect(isMeetingSla(RECORDS[1])).toBe(false);
  });

  it("breachRate: 5 of 100 = 5%", () => {
    expect(breachRate(RECORDS[0])).toBe(5);
  });

  it("complianceRate: 95%", () => {
    expect(complianceRate(RECORDS[0])).toBe(95);
  });

  it("overallSlaHealth: booking_confirmation breaching → at_risk", () => {
    expect(overallSlaHealth(RECORDS)).toBe("at_risk");
  });

  it("isCritical: confirmation 45min > 120min critical? No → false", () => {
    expect(isCritical(RECORDS[2])).toBe(false);
  });
});
