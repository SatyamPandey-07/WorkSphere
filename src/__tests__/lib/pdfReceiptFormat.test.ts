// Self-contained tests for PDF receipt field formatting logic

function formatCurrency(amount: number, currency: "USD" | "EUR" | "GBP"): string {
  const symbols: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };
  const symbol = symbols[currency] ?? currency;
  return `${symbol}${amount.toFixed(2)}`;
}

function formatReceiptDate(isoDate: string): string {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return "Invalid Date";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function truncateVenueName(name: string, maxLen = 50): string {
  if (name.length <= maxLen) return name;
  return name.slice(0, maxLen - 3) + "...";
}

function formatConfirmationId(raw: string): string {
  return raw.slice(0, 8).toUpperCase();
}

describe("pdfReceiptFormat - formatCurrency", () => {
  it("formats USD amounts with dollar sign", () => {
    expect(formatCurrency(25.0, "USD")).toBe("$25.00");
    expect(formatCurrency(1000.5, "USD")).toBe("$1000.50");
  });

  it("formats EUR amounts with euro sign", () => {
    expect(formatCurrency(49.99, "EUR")).toBe("€49.99");
  });

  it("formats GBP amounts with pound sign", () => {
    expect(formatCurrency(10, "GBP")).toBe("£10.00");
  });

  it("always formats to 2 decimal places", () => {
    expect(formatCurrency(5, "USD")).toBe("$5.00");
    expect(formatCurrency(5.1, "USD")).toBe("$5.10");
    expect(formatCurrency(5.123, "USD")).toBe("$5.12");
  });

  it("handles zero amount", () => {
    expect(formatCurrency(0, "USD")).toBe("$0.00");
  });
});

describe("pdfReceiptFormat - formatReceiptDate", () => {
  it("converts ISO date string to readable format", () => {
    const result = formatReceiptDate("2024-12-25T00:00:00.000Z");
    expect(result).toContain("December");
    expect(result).toContain("2024");
  });

  it("returns 'Invalid Date' for malformed input", () => {
    expect(formatReceiptDate("not-a-date")).toBe("Invalid Date");
    expect(formatReceiptDate("")).toBe("Invalid Date");
  });

  it("formats a standard booking date", () => {
    const result = formatReceiptDate("2025-03-15T10:00:00.000Z");
    expect(result).toContain("2025");
    expect(result).toContain("15");
  });
});

describe("pdfReceiptFormat - truncateVenueName", () => {
  it("does not truncate names at or under 50 characters", () => {
    const name = "A".repeat(50);
    expect(truncateVenueName(name)).toBe(name);
  });

  it("truncates names longer than 50 characters with ellipsis", () => {
    const longName = "A".repeat(60);
    const result = truncateVenueName(longName);
    expect(result.length).toBe(50);
    expect(result.endsWith("...")).toBe(true);
  });

  it("truncates exactly at 51 characters", () => {
    const name = "B".repeat(51);
    const result = truncateVenueName(name);
    expect(result.length).toBe(50);
    expect(result.endsWith("...")).toBe(true);
  });

  it("preserves short names unchanged", () => {
    expect(truncateVenueName("The Grand Hall")).toBe("The Grand Hall");
  });
});

describe("pdfReceiptFormat - formatConfirmationId", () => {
  it("returns first 8 characters in uppercase", () => {
    expect(formatConfirmationId("abcdefgh1234")).toBe("ABCDEFGH");
  });

  it("uppercases lowercase confirmation IDs", () => {
    expect(formatConfirmationId("xyz12345extra")).toBe("XYZ12345");
  });

  it("handles IDs that are exactly 8 characters", () => {
    expect(formatConfirmationId("CONF1234")).toBe("CONF1234");
  });

  it("handles mixed-case IDs", () => {
    expect(formatConfirmationId("bOoK1234xyz")).toBe("BOOK1234");
  });
});
