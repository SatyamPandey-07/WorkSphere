/**
 * Tests for booking receipt email content generation.
 */

interface ReceiptData {
  bookingId: string;
  venueName: string;
  date: string;
  checkIn: string;
  checkOut: string;
  totalCents: number;
  currency: string;
  userName: string;
}

function formatCurrency(cents: number, currency: string): string {
  const amount = (cents / 100).toFixed(2);
  return `${currency} ${amount}`;
}

function generateReceiptSubject(data: ReceiptData): string {
  return `Booking Confirmation #${data.bookingId} – ${data.venueName}`;
}

function generateReceiptText(data: ReceiptData): string {
  return [
    `Dear ${data.userName},`,
    "",
    `Your booking at ${data.venueName} is confirmed.`,
    `Date: ${data.date}`,
    `Check-in: ${data.checkIn}  Check-out: ${data.checkOut}`,
    `Total: ${formatCurrency(data.totalCents, data.currency)}`,
    "",
    `Booking ID: ${data.bookingId}`,
  ].join("\n");
}

const RECEIPT: ReceiptData = {
  bookingId: "BK-1234",
  venueName: "The Cowork Studio",
  date: "2026-10-01",
  checkIn: "09:00",
  checkOut: "17:00",
  totalCents: 5000,
  currency: "USD",
  userName: "Alice",
};

describe("Booking receipt email", () => {
  it("formatCurrency: 5000 cents = USD 50.00", () => {
    expect(formatCurrency(5000, "USD")).toBe("USD 50.00");
  });

  it("formatCurrency: 0 cents = USD 0.00", () => {
    expect(formatCurrency(0, "USD")).toBe("USD 0.00");
  });

  it("formatCurrency: non-round amount", () => {
    expect(formatCurrency(1099, "EUR")).toBe("EUR 10.99");
  });

  it("subject includes booking ID", () => {
    expect(generateReceiptSubject(RECEIPT)).toContain("BK-1234");
  });

  it("subject includes venue name", () => {
    expect(generateReceiptSubject(RECEIPT)).toContain("The Cowork Studio");
  });

  it("receipt text includes user name", () => {
    expect(generateReceiptText(RECEIPT)).toContain("Alice");
  });

  it("receipt text includes date", () => {
    expect(generateReceiptText(RECEIPT)).toContain("2026-10-01");
  });

  it("receipt text includes formatted total", () => {
    expect(generateReceiptText(RECEIPT)).toContain("USD 50.00");
  });

  it("receipt text includes booking ID", () => {
    expect(generateReceiptText(RECEIPT)).toContain("BK-1234");
  });
});
