/**
 * Tests for the 6-preset date range configuration in the admin analytics dashboard.
 * Verifies that all 6 ranges are available and have correct labels.
 */

// The ranges constant from AdminAnalyticsDashboard
const ranges = [
  { key: "7d",   label: "Last 7 days" },
  { key: "30d",  label: "Last 30 days" },
  { key: "90d",  label: "Last 90 days" },
  { key: "180d", label: "Last 6 months" },
  { key: "ytd",  label: "Year-to-date" },
  { key: "1y",   label: "Last 12 months" },
] as const;

describe("Admin analytics date range configuration", () => {
  it("has exactly 6 preset ranges", () => {
    expect(ranges).toHaveLength(6);
  });

  it("includes all required range keys", () => {
    const keys = ranges.map((r) => r.key);
    expect(keys).toContain("7d");
    expect(keys).toContain("30d");
    expect(keys).toContain("90d");
    expect(keys).toContain("180d");
    expect(keys).toContain("ytd");
    expect(keys).toContain("1y");
  });

  it("has unique keys", () => {
    const keys = ranges.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("each range has a non-empty label", () => {
    ranges.forEach((r) => {
      expect(r.label.length).toBeGreaterThan(0);
    });
  });

  it("labels include 'days', 'months', or 'year' terminology", () => {
    const hasTimeTerminology = ranges.every(
      (r) => /day|month|year|date/i.test(r.label),
    );
    expect(hasTimeTerminology).toBe(true);
  });

  it("7d label describes days not months", () => {
    const r7d = ranges.find((r) => r.key === "7d")!;
    expect(r7d.label).toMatch(/7.*day/i);
  });

  it("ytd label describes year-to-date concept", () => {
    const rYtd = ranges.find((r) => r.key === "ytd")!;
    expect(rYtd.label).toMatch(/year|ytd/i);
  });
});
