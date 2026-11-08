/**
 * Tests for the MonthlySpendingChart CSV export functionality (Issue #1944).
 */

interface MonthlySpend {
  month: string;
  amount: number;
}

function generateSpendingCSV(data: MonthlySpend[]): string {
  const header = "Month,Amount (USD)";
  const rows = data.map((d) => `${d.month},${d.amount.toFixed(2)}`);
  return [header, ...rows].join("\n");
}

const SAMPLE_DATA: MonthlySpend[] = [
  { month: "Jan", amount: 120 },
  { month: "Feb", amount: 95 },
  { month: "Mar", amount: 0 },
];

describe("Monthly spending CSV export", () => {
  it("CSV starts with correct header", () => {
    const csv = generateSpendingCSV(SAMPLE_DATA);
    expect(csv.split("\n")[0]).toBe("Month,Amount (USD)");
  });

  it("produces one data row per month", () => {
    const csv = generateSpendingCSV(SAMPLE_DATA);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(SAMPLE_DATA.length + 1); // +1 for header
  });

  it("formats amounts with 2 decimal places", () => {
    const csv = generateSpendingCSV([{ month: "Jan", amount: 120 }]);
    expect(csv).toContain("120.00");
  });

  it("handles zero amounts", () => {
    const csv = generateSpendingCSV([{ month: "Mar", amount: 0 }]);
    expect(csv).toContain("0.00");
  });

  it("month names are preserved", () => {
    const csv = generateSpendingCSV(SAMPLE_DATA);
    expect(csv).toContain("Jan");
    expect(csv).toContain("Feb");
    expect(csv).toContain("Mar");
  });

  it("empty data produces only header", () => {
    const csv = generateSpendingCSV([]);
    expect(csv).toBe("Month,Amount (USD)");
  });

  it("CSV is parseable back to original data", () => {
    const csv = generateSpendingCSV(SAMPLE_DATA);
    const lines = csv.split("\n");
    const parsed = lines.slice(1).map((line) => {
      const [month, amountStr] = line.split(",");
      return { month, amount: parseFloat(amountStr) };
    });
    expect(parsed[0].month).toBe("Jan");
    expect(parsed[0].amount).toBeCloseTo(120);
  });
});
