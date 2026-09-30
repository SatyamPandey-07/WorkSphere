/**
 * Tests for venue check-in OTP generation and validation.
 */

function generateNumericOtp(digits = 6): string {
  let otp = "";
  for (let i = 0; i < digits; i++) {
    otp += Math.floor(Math.random() * 10).toString();
  }
  return otp;
}

function isValidOtpFormat(otp: string, expectedDigits = 6): boolean {
  return /^\d+$/.test(otp) && otp.length === expectedDigits;
}

interface OtpRecord {
  userId: string;
  venueId: string;
  otp: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
}

function isOtpValid(record: OtpRecord, otp: string, nowMs: number): boolean {
  if (record.used) return false;
  if (nowMs > record.expiresAt) return false;
  return record.otp === otp;
}

function useOtp(record: OtpRecord): OtpRecord {
  return { ...record, used: true };
}

const NOW = 1_700_000_000_000;
const RECORD: OtpRecord = {
  userId: "u1", venueId: "v1", otp: "123456",
  createdAt: NOW, expiresAt: NOW + 300_000, used: false,
};

describe("Venue check-in OTP", () => {
  it("generateNumericOtp default 6 digits", () => {
    const otp = generateNumericOtp();
    expect(otp).toHaveLength(6);
    expect(/^\d+$/.test(otp)).toBe(true);
  });

  it("generateNumericOtp custom length", () => {
    expect(generateNumericOtp(4)).toHaveLength(4);
  });

  it("isValidOtpFormat: valid 6-digit", () => {
    expect(isValidOtpFormat("123456")).toBe(true);
  });

  it("isValidOtpFormat: letters → false", () => {
    expect(isValidOtpFormat("12345a")).toBe(false);
  });

  it("isValidOtpFormat: wrong length → false", () => {
    expect(isValidOtpFormat("12345")).toBe(false);
  });

  it("isOtpValid: correct otp within window", () => {
    expect(isOtpValid(RECORD, "123456", NOW + 1000)).toBe(true);
  });

  it("isOtpValid: wrong otp → false", () => {
    expect(isOtpValid(RECORD, "000000", NOW)).toBe(false);
  });

  it("isOtpValid: expired → false", () => {
    expect(isOtpValid(RECORD, "123456", NOW + 400_000)).toBe(false);
  });

  it("isOtpValid: already used → false", () => {
    const used = useOtp(RECORD);
    expect(isOtpValid(used, "123456", NOW)).toBe(false);
  });

  it("useOtp is immutable", () => {
    useOtp(RECORD);
    expect(RECORD.used).toBe(false);
  });
});
