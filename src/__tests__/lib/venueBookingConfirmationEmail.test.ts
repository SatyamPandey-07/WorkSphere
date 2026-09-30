/**
 * Tests for booking confirmation email content generation.
 */

interface ConfirmationEmailData {
  bookingId: string;
  userName: string;
  venueName: string;
  venueAddress: string;
  date: string;
  startTime: string;
  endTime: string;
  seatType: string;
  totalCents: number;
  currency: string;
  confirmationCode: string;
  venuePhone?: string;
  specialInstructions?: string;
}

function generateConfirmationSubject(data: ConfirmationEmailData): string {
  return `Booking Confirmed: ${data.venueName} on ${data.date}`;
}

function generateConfirmationBody(data: ConfirmationEmailData): string {
  const price = `${data.currency} ${(data.totalCents / 100).toFixed(2)}`;
  const lines = [
    `Dear ${data.userName},`,
    "",
    `Your booking at ${data.venueName} has been confirmed!`,
    "",
    `📅 Date: ${data.date}`,
    `🕐 Time: ${data.startTime} - ${data.endTime}`,
    `💺 Space: ${data.seatType.replace(/_/g, " ")}`,
    `💰 Total: ${price}`,
    `📍 Address: ${data.venueAddress}`,
    "",
    `Confirmation Code: ${data.confirmationCode}`,
  ];

  if (data.venuePhone) lines.push(`📞 Phone: ${data.venuePhone}`);
  if (data.specialInstructions) lines.push("", `ℹ️ Note: ${data.specialInstructions}`);

  return lines.join("\n");
}

function isEmailComplete(data: ConfirmationEmailData): boolean {
  return Boolean(
    data.bookingId && data.userName && data.venueName &&
    data.date && data.startTime && data.endTime && data.confirmationCode
  );
}

const DATA: ConfirmationEmailData = {
  bookingId: "b1", userName: "Alice", venueName: "The Coffee Hub",
  venueAddress: "123 Main St, NYC", date: "2026-10-15",
  startTime: "09:00", endTime: "12:00", seatType: "hot_desk",
  totalCents: 3000, currency: "USD", confirmationCode: "WS-ABC123",
  venuePhone: "+1 555-1234",
};

describe("Booking confirmation email", () => {
  it("generateConfirmationSubject: includes venue and date", () => {
    const subject = generateConfirmationSubject(DATA);
    expect(subject).toContain("The Coffee Hub");
    expect(subject).toContain("2026-10-15");
  });

  it("generateConfirmationBody: includes user name", () => {
    expect(generateConfirmationBody(DATA)).toContain("Alice");
  });

  it("generateConfirmationBody: includes formatted price", () => {
    expect(generateConfirmationBody(DATA)).toContain("USD 30.00");
  });

  it("generateConfirmationBody: includes confirmation code", () => {
    expect(generateConfirmationBody(DATA)).toContain("WS-ABC123");
  });

  it("generateConfirmationBody: optional phone included when provided", () => {
    expect(generateConfirmationBody(DATA)).toContain("+1 555-1234");
  });

  it("generateConfirmationBody: no phone section when omitted", () => {
    const noPhone = { ...DATA, venuePhone: undefined };
    expect(generateConfirmationBody(noPhone)).not.toContain("Phone");
  });

  it("isEmailComplete: all required fields → true", () => {
    expect(isEmailComplete(DATA)).toBe(true);
  });

  it("isEmailComplete: missing confirmationCode → false", () => {
    expect(isEmailComplete({ ...DATA, confirmationCode: "" })).toBe(false);
  });
});
