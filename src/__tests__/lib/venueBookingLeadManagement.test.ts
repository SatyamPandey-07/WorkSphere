/**
 * Tests for venue booking lead management and sales pipeline.
 */

type LeadStage = "new" | "contacted" | "qualified" | "proposal_sent" | "negotiating" | "won" | "lost";
type LeadSource = "website" | "referral" | "social" | "cold_outreach" | "event" | "partner";

interface Lead {
  id: string;
  name: string;
  company: string;
  stage: LeadStage;
  source: LeadSource;
  estimatedValue: number;
  probability: number;  // 0-1
  createdAt: number;
  lastContactAt: number;
  assignedTo: string;
}

function weightedPipelineValue(leads: Lead[]): number {
  return Math.round(
    leads
      .filter((l) => l.stage !== "won" && l.stage !== "lost")
      .reduce((s, l) => s + l.estimatedValue * l.probability, 0) * 100
  ) / 100;
}

function conversionRate(leads: Lead[]): number {
  const closed = leads.filter((l) => l.stage === "won" || l.stage === "lost").length;
  if (closed === 0) return 0;
  const won = leads.filter((l) => l.stage === "won").length;
  return Math.round((won / closed) * 100);
}

function staleLeads(leads: Lead[], nowMs: number, staleDays = 14): Lead[] {
  return leads
    .filter((l) => l.stage !== "won" && l.stage !== "lost")
    .filter((l) => nowMs - l.lastContactAt > staleDays * 86_400_000);
}

function leadsBySource(leads: Lead[]): Record<LeadSource, number> {
  const result: Partial<Record<LeadSource, number>> = {};
  for (const l of leads) result[l.source] = (result[l.source] ?? 0) + 1;
  return result as Record<LeadSource, number>;
}

function avgDealSize(leads: Lead[]): number {
  const won = leads.filter((l) => l.stage === "won");
  if (won.length === 0) return 0;
  return Math.round(won.reduce((s, l) => s + l.estimatedValue, 0) / won.length);
}

const NOW = 1_700_000_000_000;
const LEADS: Lead[] = [
  { id: "l1", name: "Alice Corp", company: "A Co",  stage: "won",           source: "referral",   estimatedValue: 5000,  probability: 1,   createdAt: NOW - 30 * 86_400_000, lastContactAt: NOW - 5  * 86_400_000, assignedTo: "rep1" },
  { id: "l2", name: "Bob Ltd",    company: "B Ltd", stage: "negotiating",   source: "website",    estimatedValue: 8000,  probability: 0.7, createdAt: NOW - 15 * 86_400_000, lastContactAt: NOW - 20 * 86_400_000, assignedTo: "rep1" },
  { id: "l3", name: "Carol Inc",  company: "C Inc", stage: "proposal_sent", source: "social",     estimatedValue: 3000,  probability: 0.4, createdAt: NOW - 10 * 86_400_000, lastContactAt: NOW - 2  * 86_400_000, assignedTo: "rep2" },
  { id: "l4", name: "Dave GmbH",  company: "D Co",  stage: "lost",          source: "cold_outreach",estimatedValue: 2000, probability: 0,   createdAt: NOW - 45 * 86_400_000, lastContactAt: NOW - 30 * 86_400_000, assignedTo: "rep2" },
];

describe("Lead management and sales pipeline", () => {
  it("weightedPipelineValue: 8000*0.7 + 3000*0.4 = $6800", () => {
    expect(weightedPipelineValue(LEADS)).toBe(6800);
  });

  it("conversionRate: 1 won, 1 lost = 50%", () => {
    expect(conversionRate(LEADS)).toBe(50);
  });

  it("staleLeads: l2 last contacted 20 days ago → stale", () => {
    const stale = staleLeads(LEADS, NOW);
    expect(stale.map((l) => l.id)).toContain("l2");
  });

  it("avgDealSize: 1 won deal at $5000", () => {
    expect(avgDealSize(LEADS)).toBe(5000);
  });

  it("leadsBySource: 1 from website", () => {
    expect(leadsBySource(LEADS).website).toBe(1);
  });
});
