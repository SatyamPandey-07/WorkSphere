/**
 * Tests for credit card number validation (Luhn algorithm).
 */

function luhnCheck(cardNumber: string): boolean {
  const digits = cardNumber.replace(/\D/g, "").split("").map(Number);
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = digits[i];
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function detectCardType(cardNumber: string): "visa" | "mastercard" | "amex" | "discover" | "unknown" {
  const clean = cardNumber.replace(/\D/g, "");
  if (/^4/.test(clean)) return "visa";
  if (/^5[1-5]/.test(clean)) return "mastercard";
  if (/^3[47]/.test(clean)) return "amex";
  if (/^6(?:011|5)/.test(clean)) return "discover";
  return "unknown";
}

function maskCardNumber(cardNumber: string): string {
  const clean = cardNumber.replace(/\D/g, "");
  if (clean.length < 4) return cardNumber;
  return "•••• •••• •••• " + clean.slice(-4);
}

function isExpiryValid(month: number, year: number, nowMs = Date.now()): boolean {
  const now = new Date(nowMs);
  const expiryDate = new Date(year, month, 0); // last day of expiry month
  return expiryDate.getTime() > nowMs;
}

describe("Credit card validation", () => {
  it("luhnCheck: valid Visa test number", () => {
    expect(luhnCheck("4111111111111111")).toBe(true);
  });

  it("luhnCheck: invalid number", () => {
    expect(luhnCheck("4111111111111112")).toBe(false);
  });

  it("luhnCheck: too short → false", () => {
    expect(luhnCheck("41111")).toBe(false);
  });

  it("detectCardType: starts with 4 → visa", () => {
    expect(detectCardType("4111111111111111")).toBe("visa");
  });

  it("detectCardType: starts with 51 → mastercard", () => {
    expect(detectCardType("5100000000000000")).toBe("mastercard");
  });

  it("detectCardType: starts with 34 → amex", () => {
    expect(detectCardType("340000000000000")).toBe("amex");
  });

  it("maskCardNumber: shows last 4 digits", () => {
    const masked = maskCardNumber("4111111111111234");
    expect(masked).toBe("•••• •••• •••• 1234");
  });

  it("isExpiryValid: future date → true", () => {
    const now = new Date();
    expect(isExpiryValid(now.getMonth() + 2, now.getFullYear())).toBe(true);
  });

  it("isExpiryValid: past date → false", () => {
    expect(isExpiryValid(1, 2020)).toBe(false);
  });
});
