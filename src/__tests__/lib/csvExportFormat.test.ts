/**
 * Tests for saved venues CSV export formatting.
 */

interface SavedVenueRow {
  name: string;
  category?: string;
  address?: string;
  wifiQuality?: number;
  noiseLevel?: string;
  rating?: number;
}

function escapeCsvValue(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function rowToCsv(row: SavedVenueRow): string {
  const fields = [
    row.name,
    row.category ?? "",
    row.address ?? "",
    row.wifiQuality !== undefined ? String(row.wifiQuality) : "",
    row.noiseLevel ?? "",
    row.rating !== undefined ? String(row.rating) : "",
  ];
  return fields.map(escapeCsvValue).join(",");
}

describe("CSV export format", () => {
  it("formats a basic row correctly", () => {
    const csv = rowToCsv({ name: "Test Café", category: "cafe", wifiQuality: 4 });
    expect(csv).toContain("Test Café");
    expect(csv).toContain("cafe");
    expect(csv).toContain("4");
  });

  it("escapes names with commas", () => {
    const csv = rowToCsv({ name: "Smith, Jones Café" });
    expect(csv).toContain('"Smith, Jones Café"');
  });

  it("escapes names with double quotes", () => {
    const csv = rowToCsv({ name: 'The "Best" Café' });
    expect(csv.startsWith('"The ""Best"" Café"')).toBe(true);
  });

  it("optional fields produce empty strings when missing", () => {
    const csv = rowToCsv({ name: "Test" });
    const parts = csv.split(",");
    expect(parts).toHaveLength(6);
    expect(parts[1]).toBe(""); // category
    expect(parts[2]).toBe(""); // address
  });

  it("numeric fields are stringified", () => {
    const csv = rowToCsv({ name: "Test", wifiQuality: 5, rating: 4.5 });
    expect(csv).toContain("5");
    expect(csv).toContain("4.5");
  });
});
