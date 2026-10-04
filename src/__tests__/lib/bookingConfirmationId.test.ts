/**
 * Tests for booking confirmation ID generation and validation.
 */

function isValidConfirmationId(id: string): boolean {
  // Confirmation IDs are cuid-like: start with 'c', followed by 24 alphanumeric chars
  return /^c[a-z0-9]{24}$/.test(id);
}

function formatConfirmationDisplay(id: string): string {
  // Display format: first 8 chars uppercase for user-facing ID
  return id.slice(0, 8).toUpperCase();
}

function maskConfirmationId(id: string): string {
  // Show first 4 + last 4, mask middle
  if (id.length <= 8) return id;
  return `${id.slice(0, 4)}...${id.slice(-4)}`;
}

describe("Booking confirmation ID handling", () => {
  const validId = "cabcdefghijk1234567890abcd";

  it("valid cuid-like ID passes validation", () => {
    expect(isValidConfirmationId(validId)).toBe(true);
  });

  it("empty string fails validation", () => {
    expect(isValidConfirmationId("")).toBe(false);
  });

  it("ID not starting with c fails validation", () => {
    expect(isValidConfirmationId("babcdefghijk1234567890abcd")).toBe(false);
  });

  it("ID with uppercase letters fails validation", () => {
    expect(isValidConfirmationId("cABCDEFGHIJK1234567890ABCD")).toBe(false);
  });

  it("formatConfirmationDisplay returns uppercase 8-char prefix", () => {
    const display = formatConfirmationDisplay(validId);
    expect(display).toBe(validId.slice(0, 8).toUpperCase());
    expect(display).toHaveLength(8);
  });

  it("maskConfirmationId shows first 4 + last 4", () => {
    const masked = maskConfirmationId(validId);
    expect(masked).toContain("...");
    expect(masked.startsWith(validId.slice(0, 4))).toBe(true);
    expect(masked.endsWith(validId.slice(-4))).toBe(true);
  });

  it("maskConfirmationId preserves short IDs", () => {
    expect(maskConfirmationId("short")).toBe("short");
  });
});
