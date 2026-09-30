/**
 * Tests for venue booking contract template generation.
 */

interface ContractTemplate {
  templateId: string;
  venueId: string;
  name: string;
  clauses: { clauseId: string; title: string; content: string; required: boolean }[];
  version: string;
  lastUpdatedAt: number;
}

interface ContractData {
  bookingId: string;
  userId: string;
  venueName: string;
  startDate: string;
  endDate: string;
  monthlyRentCents: number;
  signatoryName: string;
  additionalClauses?: string[];
}

function fillContractTemplate(template: ContractTemplate, data: ContractData): string {
  let content = `CONTRACT - ${data.venueName}\n`;
  content += `Parties: ${data.signatoryName} and ${data.venueName}\n`;
  content += `Period: ${data.startDate} to ${data.endDate}\n`;
  content += `Monthly Rent: ${data.monthlyRentCents / 100} USD\n\n`;

  for (const clause of template.clauses) {
    content += `${clause.title}\n${clause.content}\n\n`;
  }

  if (data.additionalClauses) {
    data.additionalClauses.forEach((c, i) => {
      content += `Additional Clause ${i + 1}\n${c}\n\n`;
    });
  }

  return content;
}

function requiredClauses(template: ContractTemplate): ContractTemplate["clauses"] {
  return template.clauses.filter((c) => c.required);
}

function validateContractData(data: ContractData): string[] {
  const errors: string[] = [];
  if (!data.signatoryName.trim()) errors.push("Signatory name required");
  if (!data.startDate) errors.push("Start date required");
  if (!data.endDate) errors.push("End date required");
  if (data.startDate >= data.endDate) errors.push("End date must be after start date");
  if (data.monthlyRentCents <= 0) errors.push("Rent must be positive");
  return errors;
}

const TEMPLATE: ContractTemplate = {
  templateId: "tmpl1", venueId: "v1", name: "Standard License",
  clauses: [
    { clauseId: "c1", title: "Permitted Use", content: "Space for coworking only", required: true  },
    { clauseId: "c2", title: "Payment Terms", content: "Due on 1st of month",       required: true  },
    { clauseId: "c3", title: "Optional Parking", content: "If requested",           required: false },
  ],
  version: "2.0",
  lastUpdatedAt: 1_700_000_000_000,
};

const CONTRACT_DATA: ContractData = {
  bookingId: "bk1", userId: "u1", venueName: "The Hub",
  startDate: "2026-11-01", endDate: "2027-10-31",
  monthlyRentCents: 50_000, signatoryName: "Alice Smith",
};

describe("Venue booking contract template", () => {
  it("fillContractTemplate: includes signatory name", () => {
    const content = fillContractTemplate(TEMPLATE, CONTRACT_DATA);
    expect(content).toContain("Alice Smith");
  });

  it("fillContractTemplate: includes all clauses", () => {
    const content = fillContractTemplate(TEMPLATE, CONTRACT_DATA);
    expect(content).toContain("Permitted Use");
    expect(content).toContain("Payment Terms");
    expect(content).toContain("Optional Parking");
  });

  it("fillContractTemplate: includes additional clauses when provided", () => {
    const data = { ...CONTRACT_DATA, additionalClauses: ["Special equipment stored on-site"] };
    expect(fillContractTemplate(TEMPLATE, data)).toContain("Special equipment");
  });

  it("requiredClauses: 2 required clauses", () => {
    expect(requiredClauses(TEMPLATE)).toHaveLength(2);
  });

  it("validateContractData: valid data → no errors", () => {
    expect(validateContractData(CONTRACT_DATA)).toHaveLength(0);
  });

  it("validateContractData: start >= end → error", () => {
    const invalid = { ...CONTRACT_DATA, endDate: "2026-10-01" };
    expect(validateContractData(invalid).some((e) => /after/i.test(e))).toBe(true);
  });

  it("validateContractData: zero rent → error", () => {
    expect(validateContractData({ ...CONTRACT_DATA, monthlyRentCents: 0 }).length).toBeGreaterThan(0);
  });
});
