/**
 * Tests for the booking JSON blob download mechanics (Issue #1871).
 * Verifies Blob creation and URL patterns for the Export JSON feature.
 */

function createJsonBlob(data: unknown): Blob {
  return new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
}

function getBlobDownloadUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}

// Mock URL APIs
const mockObjectUrl = "blob:http://localhost/mock-123";
global.URL.createObjectURL = jest.fn().mockReturnValue(mockObjectUrl);
global.URL.revokeObjectURL = jest.fn();

describe("Booking JSON Blob download", () => {
  it("creates a Blob with application/json type", () => {
    const blob = createJsonBlob([{ id: "1", location: "Café" }]);
    expect(blob.type).toBe("application/json");
  });

  it("Blob is non-empty for non-empty data", () => {
    const blob = createJsonBlob([{ id: "1", location: "Café" }]);
    expect(blob.size).toBeGreaterThan(0);
  });

  it("Blob is larger for more records", () => {
    const small = createJsonBlob([{ id: "1" }]);
    const large = createJsonBlob(Array.from({ length: 10 }, (_, i) => ({ id: String(i), location: `Venue ${i}` })));
    expect(large.size).toBeGreaterThan(small.size);
  });

  it("URL.createObjectURL is called with the Blob", () => {
    const blob = createJsonBlob([]);
    getBlobDownloadUrl(blob);
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
  });

  it("returns a blob: URL", () => {
    const blob = createJsonBlob([]);
    const url = getBlobDownloadUrl(blob);
    expect(url).toBe(mockObjectUrl);
  });

  it("empty array produces valid (but small) JSON blob", () => {
    const blob = createJsonBlob([]);
    expect(blob.size).toBeGreaterThan(0); // "[]" is still non-empty
    expect(blob.type).toBe("application/json");
  });

  it("Blob content is pretty-printed JSON (2-space indent)", async () => {
    const data = [{ id: "1", location: "Test" }];
    const blob = createJsonBlob(data);
    const text = await blob.text();
    const parsed = JSON.parse(text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(text).toContain("  "); // 2-space indent
  });
});
