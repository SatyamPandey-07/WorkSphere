/**
 * Tests for the Export History (JSON) feature (Issue #1871).
 * The export should produce valid JSON with correct fields.
 */

interface CheckIn {
  id: string;
  location: string;
  date: string;
  hoursSpent: number;
  wifiStatus: "Excellent" | "Good" | "Fair" | "Poor";
  timezone?: string;
}

function generateJsonExport(checkIns: CheckIn[]): string {
  const records = checkIns.map((c) => ({
    id: c.id,
    location: c.location,
    date: c.date,
    hoursSpent: c.hoursSpent,
    wifiStatus: c.wifiStatus,
    timezone: c.timezone ?? null,
  }));
  return JSON.stringify(records, null, 2);
}

const SAMPLE_CHECKINS: CheckIn[] = [
  { id: "1", location: "The Roasted Bean Cafe", date: "Today, 9:00 AM", hoursSpent: 4.5, wifiStatus: "Excellent", timezone: "America/New_York" },
  { id: "2", location: "WeWork Downtown", date: "Yesterday, 2:30 PM", hoursSpent: 3, wifiStatus: "Good", timezone: "America/Chicago" },
];

describe("Export History JSON generation", () => {
  it("produces valid JSON", () => {
    const json = generateJsonExport(SAMPLE_CHECKINS);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("output is a JSON array", () => {
    const json = generateJsonExport(SAMPLE_CHECKINS);
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("contains one record per check-in", () => {
    const json = generateJsonExport(SAMPLE_CHECKINS);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(SAMPLE_CHECKINS.length);
  });

  it("each record has all required fields", () => {
    const json = generateJsonExport(SAMPLE_CHECKINS);
    const parsed = JSON.parse(json);
    const required = ["id", "location", "date", "hoursSpent", "wifiStatus", "timezone"];
    parsed.forEach((record: Record<string, unknown>) => {
      required.forEach((field) => {
        expect(Object.keys(record)).toContain(field);
      });
    });
  });

  it("timezone is null when not provided", () => {
    const noTz: CheckIn[] = [{ id: "x", location: "Café", date: "Now", hoursSpent: 1, wifiStatus: "Good" }];
    const json = generateJsonExport(noTz);
    const parsed = JSON.parse(json);
    expect(parsed[0].timezone).toBeNull();
  });

  it("output is formatted with 2-space indentation", () => {
    const json = generateJsonExport(SAMPLE_CHECKINS);
    expect(json).toContain("  "); // 2-space indent
  });

  it("empty check-ins produce empty array", () => {
    const json = generateJsonExport([]);
    expect(JSON.parse(json)).toEqual([]);
  });

  it("wifiStatus is preserved in export", () => {
    const json = generateJsonExport(SAMPLE_CHECKINS);
    const parsed = JSON.parse(json);
    expect(parsed[0].wifiStatus).toBe("Excellent");
    expect(parsed[1].wifiStatus).toBe("Good");
  });
});
