/**
 * Tests for QR check-in code generation and validation.
 */

interface QrPayload {
  bookingId: string;
  venueId: string;
  userId: string;
  validFrom: number;
  validUntil: number;
}

function encodeQrPayload(payload: QrPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeQrPayload(encoded: string): QrPayload | null {
  try {
    const raw = Buffer.from(encoded, "base64url").toString("utf8");
    return JSON.parse(raw) as QrPayload;
  } catch {
    return null;
  }
}

function isQrValid(payload: QrPayload, nowMs: number): boolean {
  return nowMs >= payload.validFrom && nowMs <= payload.validUntil;
}

const BASE = 1_700_000_000_000;
const PAYLOAD: QrPayload = {
  bookingId: "bk-1", venueId: "v-1", userId: "u-1",
  validFrom: BASE, validUntil: BASE + 3_600_000,
};

describe("QR check-in code", () => {
  it("encodes payload without error", () => {
    expect(() => encodeQrPayload(PAYLOAD)).not.toThrow();
  });

  it("round-trip encode/decode preserves all fields", () => {
    const decoded = decodeQrPayload(encodeQrPayload(PAYLOAD));
    expect(decoded).toEqual(PAYLOAD);
  });

  it("decodeQrPayload on invalid string returns null", () => {
    expect(decodeQrPayload("!!!not-base64url!!!")).toBeNull();
  });

  it("decodeQrPayload on empty string returns null", () => {
    expect(decodeQrPayload("")).toBeNull();
  });

  it("valid QR within window", () => {
    expect(isQrValid(PAYLOAD, BASE + 1_000)).toBe(true);
  });

  it("valid QR at validFrom boundary", () => {
    expect(isQrValid(PAYLOAD, BASE)).toBe(true);
  });

  it("valid QR at validUntil boundary", () => {
    expect(isQrValid(PAYLOAD, BASE + 3_600_000)).toBe(true);
  });

  it("invalid QR before window", () => {
    expect(isQrValid(PAYLOAD, BASE - 1)).toBe(false);
  });

  it("invalid QR after window", () => {
    expect(isQrValid(PAYLOAD, BASE + 3_600_001)).toBe(false);
  });
});
