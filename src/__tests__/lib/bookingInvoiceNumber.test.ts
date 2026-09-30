/**
 * Tests for booking invoice number generation and parsing.
 */

interface InvoiceParams {
  venueCode: string;   // 3-char uppercase
  year: number;
  month: number;
  sequence: number;
}

function generateInvoiceNumber(params: InvoiceParams): string {
  const yy = String(params.year).slice(-2);
  const mm = String(params.month).padStart(2, "0");
  const seq = String(params.sequence).padStart(5, "0");
  return `INV-${params.venueCode}-${yy}${mm}-${seq}`;
}

function parseInvoiceNumber(invoice: string): InvoiceParams | null {
  const match = invoice.match(/^INV-([A-Z]{3})-(\d{2})(\d{2})-(\d{5})$/);
  if (!match) return null;
  return {
    venueCode: match[1],
    year: 2000 + parseInt(match[2]),
    month: parseInt(match[3]),
    sequence: parseInt(match[4]),
  };
}

function isValidInvoiceNumber(invoice: string): boolean {
  return parseInvoiceNumber(invoice) !== null;
}

function nextSequence(lastInvoice: string | null, venueCode: string, year: number, month: number): number {
  if (!lastInvoice) return 1;
  const parsed = parseInvoiceNumber(lastInvoice);
  if (!parsed || parsed.venueCode !== venueCode || parsed.year !== year || parsed.month !== month) return 1;
  return parsed.sequence + 1;
}

describe("Booking invoice number", () => {
  const PARAMS: InvoiceParams = { venueCode: "HUB", year: 2026, month: 10, sequence: 42 };

  it("generateInvoiceNumber: correct format", () => {
    expect(generateInvoiceNumber(PARAMS)).toBe("INV-HUB-2610-00042");
  });

  it("sequence zero-padded to 5 digits", () => {
    expect(generateInvoiceNumber({ ...PARAMS, sequence: 1 })).toContain("-00001");
  });

  it("parseInvoiceNumber: round-trip", () => {
    const inv = generateInvoiceNumber(PARAMS);
    const parsed = parseInvoiceNumber(inv);
    expect(parsed!.venueCode).toBe("HUB");
    expect(parsed!.year).toBe(2026);
    expect(parsed!.month).toBe(10);
    expect(parsed!.sequence).toBe(42);
  });

  it("parseInvoiceNumber: invalid format → null", () => {
    expect(parseInvoiceNumber("INVOICE-123")).toBeNull();
  });

  it("isValidInvoiceNumber: valid → true", () => {
    expect(isValidInvoiceNumber(generateInvoiceNumber(PARAMS))).toBe(true);
  });

  it("isValidInvoiceNumber: garbage → false", () => {
    expect(isValidInvoiceNumber("not-an-invoice")).toBe(false);
  });

  it("nextSequence: null last → starts at 1", () => {
    expect(nextSequence(null, "HUB", 2026, 10)).toBe(1);
  });

  it("nextSequence: increments from last", () => {
    const last = generateInvoiceNumber(PARAMS); // seq 42
    expect(nextSequence(last, "HUB", 2026, 10)).toBe(43);
  });

  it("nextSequence: different month resets to 1", () => {
    const last = generateInvoiceNumber(PARAMS);
    expect(nextSequence(last, "HUB", 2026, 11)).toBe(1);
  });
});
