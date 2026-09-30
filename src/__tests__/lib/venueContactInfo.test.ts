/**
 * Tests for venue contact information validation.
 */

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function isValidPhone(phone: string): boolean {
  // Allow +, digits, spaces, dashes, parentheses
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 && /^[\d\s\-+().]+$/.test(phone);
}

function isValidWebsite(url: string): boolean {
  return /^https?:\/\/[^\s/$.?#].[^\s]*$/.test(url);
}

function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-().]/g, "");
}

interface VenueContact {
  email?: string;
  phone?: string;
  website?: string;
}

function validateContact(contact: VenueContact): string[] {
  const errors: string[] = [];
  if (contact.email && !isValidEmail(contact.email)) errors.push("Invalid email");
  if (contact.phone && !isValidPhone(contact.phone)) errors.push("Invalid phone");
  if (contact.website && !isValidWebsite(contact.website)) errors.push("Invalid website URL");
  return errors;
}

describe("Venue contact information", () => {
  it("valid email", () => {
    expect(isValidEmail("info@cafe.com")).toBe(true);
  });

  it("invalid email: no @", () => {
    expect(isValidEmail("notanemail")).toBe(false);
  });

  it("invalid email: no domain", () => {
    expect(isValidEmail("user@")).toBe(false);
  });

  it("valid phone", () => {
    expect(isValidPhone("+1 (555) 123-4567")).toBe(true);
  });

  it("valid phone: digits only", () => {
    expect(isValidPhone("5551234567")).toBe(true);
  });

  it("invalid phone: too short", () => {
    expect(isValidPhone("12345")).toBe(false);
  });

  it("valid website https", () => {
    expect(isValidWebsite("https://cafe.com")).toBe(true);
  });

  it("valid website http", () => {
    expect(isValidWebsite("http://cafe.com/about")).toBe(true);
  });

  it("invalid website: no protocol", () => {
    expect(isValidWebsite("cafe.com")).toBe(false);
  });

  it("normalizePhone strips spaces and dashes", () => {
    expect(normalizePhone("+1 (555) 123-4567")).toBe("+15551234567");
  });

  it("validateContact: no errors for valid data", () => {
    expect(validateContact({ email: "a@b.com", phone: "1234567", website: "https://a.com" })).toHaveLength(0);
  });

  it("validateContact: collects all errors", () => {
    const errors = validateContact({ email: "bad", website: "noprotocol" });
    expect(errors).toHaveLength(2);
  });
});
