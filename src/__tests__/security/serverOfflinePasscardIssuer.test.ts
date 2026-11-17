import {
  issuePasscard,
  buildPasscardPayload,
  validateSigningJwk,
  clearSigningKeyCache,
  PRIVATE_JWK_ENV,
  UNASSIGNED_SEAT,
  DEFAULT_BOOKING_DURATION_MINUTES,
} from "@/lib/security/serverOfflinePasscardIssuer";
import {
  verifyOfflinePasscard,
  importVerificationKey,
  decodeOfflinePasscardPayload,
} from "@/lib/security/offlineQrSigner";

// Deterministic test keypair A
const TEST_KEY_A_PRIVATE = {
  kty: "EC",
  crv: "P-256",
  x: "IwWS2R4U7Cy2eRCIXQI48oi6anob6NKcLR6dIuBomeE",
  y: "BigMwQiCn-va5Vir-gCK-KZJ_sj-6yZtcYzn8mhNFJk",
  d: "OWvPLPNEV7FibA5_g9P7E7YB21xEwT57jQdhnVhdiqQ",
};

const TEST_KEY_A_PUBLIC = {
  kty: "EC",
  crv: "P-256",
  x: "IwWS2R4U7Cy2eRCIXQI48oi6anob6NKcLR6dIuBomeE",
  y: "BigMwQiCn-va5Vir-gCK-KZJ_sj-6yZtcYzn8mhNFJk",
};

// Deterministic test keypair B
const TEST_KEY_B_PUBLIC = {
  kty: "EC",
  crv: "P-256",
  x: "R9acpTPjzIK8jblzvui300LZB3rgzIz-VpMWvcrlceU",
  y: "L6tqHREL7ZgmOV-nCHTW1CG0BicaMkfZZeQHmDctsFA",
};

describe("serverOfflinePasscardIssuer (#7820)", () => {
  const originalEnv = process.env[PRIVATE_JWK_ENV];

  beforeEach(() => {
    clearSigningKeyCache();
    process.env[PRIVATE_JWK_ENV] = JSON.stringify(TEST_KEY_A_PRIVATE);
  });

  afterEach(() => {
    clearSigningKeyCache();
    if (originalEnv !== undefined) {
      process.env[PRIVATE_JWK_ENV] = originalEnv;
    } else {
      delete process.env[PRIVATE_JWK_ENV];
    }
  });

  describe("validateSigningJwk", () => {
    it("accepts a valid EC P-256 private JWK", () => {
      expect(() => validateSigningJwk(TEST_KEY_A_PRIVATE)).not.toThrow();
    });

    it("rejects non-object or null input", () => {
      expect(() => validateSigningJwk(null)).toThrow(/must be a JSON object/);
      expect(() => validateSigningJwk("not-an-object")).toThrow(/must be a JSON object/);
      expect(() => validateSigningJwk([])).toThrow(/must be a JSON object/);
    });

    it("rejects wrong kty or curve", () => {
      expect(() =>
        validateSigningJwk({ ...TEST_KEY_A_PRIVATE, kty: "RSA" }),
      ).toThrow(/must have kty="EC"/);
      expect(() =>
        validateSigningJwk({ ...TEST_KEY_A_PRIVATE, crv: "P-384" }),
      ).toThrow(/must use the P-256 curve/);
    });

    it("rejects missing or empty private component d", () => {
      expect(() =>
        validateSigningJwk({ ...TEST_KEY_A_PUBLIC }),
      ).toThrow(/must contain private component 'd'/);
      expect(() =>
        validateSigningJwk({ ...TEST_KEY_A_PRIVATE, d: "" }),
      ).toThrow(/must contain private component 'd'/);
    });

    it("rejects missing coordinates x or y", () => {
      expect(() =>
        validateSigningJwk({ ...TEST_KEY_A_PRIVATE, x: undefined }),
      ).toThrow(/must contain coordinate 'x'/);
      expect(() =>
        validateSigningJwk({ ...TEST_KEY_A_PRIVATE, y: "" }),
      ).toThrow(/must contain coordinate 'y'/);
    });
  });

  describe("buildPasscardPayload", () => {
    const baseBooking = {
      id: "booking-101",
      userId: "user-42",
      venueId: "venue-loft",
      startsAt: new Date("2026-12-01T10:00:00Z"),
      durationMinutes: 90,
      seatNumber: "Desk-12",
    };

    it("correctly constructs valid payload matching booking facts", () => {
      const payload = buildPasscardPayload(baseBooking);
      expect(payload).toEqual({
        bookingId: "booking-101",
        userId: "user-42",
        venueId: "venue-loft",
        validFrom: Math.floor(new Date("2026-12-01T10:00:00Z").getTime() / 1000),
        validUntil: Math.floor(new Date("2026-12-01T11:30:00Z").getTime() / 1000),
        seatNumber: "Desk-12",
      });
    });

    it("falls back to UNASSIGNED when seatNumber is null, undefined, or empty", () => {
      const p1 = buildPasscardPayload({ ...baseBooking, seatNumber: null });
      expect(p1.seatNumber).toBe(UNASSIGNED_SEAT);

      const p2 = buildPasscardPayload({ ...baseBooking, seatNumber: undefined });
      expect(p2.seatNumber).toBe(UNASSIGNED_SEAT);

      const p3 = buildPasscardPayload({ ...baseBooking, seatNumber: "   " });
      expect(p3.seatNumber).toBe(UNASSIGNED_SEAT);
    });

    it("falls back to DEFAULT_BOOKING_DURATION_MINUTES when duration is missing or invalid", () => {
      const p = buildPasscardPayload({ ...baseBooking, durationMinutes: null });
      const expectedEnd =
        Math.floor(baseBooking.startsAt.getTime() / 1000) +
        DEFAULT_BOOKING_DURATION_MINUTES * 60;
      expect(p.validUntil).toBe(expectedEnd);
    });

    it("respects explicit endsAt when provided", () => {
      const endsAt = new Date("2026-12-01T15:00:00Z");
      const p = buildPasscardPayload({ ...baseBooking, endsAt });
      expect(p.validUntil).toBe(Math.floor(endsAt.getTime() / 1000));
    });

    it("throws if validUntil is not strictly greater than validFrom", () => {
      expect(() =>
        buildPasscardPayload({
          ...baseBooking,
          endsAt: new Date("2026-12-01T09:00:00Z"), // before start
        }),
      ).toThrow(/must be strictly later than validFrom/);

      expect(() =>
        buildPasscardPayload({
          ...baseBooking,
          endsAt: baseBooking.startsAt, // equal to start
        }),
      ).toThrow(/must be strictly later than validFrom/);
    });

    it("rejects missing mandatory booking fields", () => {
      expect(() =>
        buildPasscardPayload({ ...baseBooking, id: "" }),
      ).toThrow(/bookingId must be a non-empty string/);
      expect(() =>
        buildPasscardPayload({ ...baseBooking, userId: "" }),
      ).toThrow(/userId must be a non-empty string/);
      expect(() =>
        buildPasscardPayload({ ...baseBooking, venueId: "" }),
      ).toThrow(/venueId must be a non-empty string/);
      expect(() =>
        buildPasscardPayload({ ...baseBooking, startsAt: new Date(NaN) }),
      ).toThrow(/startsAt must be a valid Date instance/);
    });
  });

  describe("issuePasscard", () => {
    const booking = {
      id: "bk-issuance-1",
      userId: "usr-99",
      venueId: "vn-77",
      startsAt: new Date("2026-12-10T14:00:00Z"),
      durationMinutes: 120,
      seatNumber: "A-5",
    };

    it("issues a two-segment token that verifies with the public verification key", async () => {
      const token = await issuePasscard(booking);
      expect(typeof token).toBe("string");
      expect(token.split(".")).toHaveLength(2);

      const decoded = decodeOfflinePasscardPayload(token);
      expect(decoded).toMatchObject({
        bookingId: "bk-issuance-1",
        userId: "usr-99",
        venueId: "vn-77",
        seatNumber: "A-5",
      });

      const verificationKey = await importVerificationKey(TEST_KEY_A_PUBLIC);
      const result = await verifyOfflinePasscard(token, verificationKey, {
        enforceWindow: false,
      });

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.payload.bookingId).toBe("bk-issuance-1");
      }
    });

    it("fails verification when checked against a different public key", async () => {
      const token = await issuePasscard(booking);
      const wrongKey = await importVerificationKey(TEST_KEY_B_PUBLIC);
      const result = await verifyOfflinePasscard(token, wrongKey, {
        enforceWindow: false,
      });

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("bad-signature");
    });

    it("throws if OFFLINE_PASSCARD_PRIVATE_KEY_JWK is missing", async () => {
      delete process.env[PRIVATE_JWK_ENV];
      clearSigningKeyCache();
      await expect(issuePasscard(booking)).rejects.toThrow(
        /Missing environment variable OFFLINE_PASSCARD_PRIVATE_KEY_JWK/,
      );
    });

    it("throws if OFFLINE_PASSCARD_PRIVATE_KEY_JWK is invalid JSON", async () => {
      process.env[PRIVATE_JWK_ENV] = "{ bad-json";
      clearSigningKeyCache();
      await expect(issuePasscard(booking)).rejects.toThrow(/not valid JSON/);
    });

    it("throws if OFFLINE_PASSCARD_PRIVATE_KEY_JWK lacks private component d", async () => {
      process.env[PRIVATE_JWK_ENV] = JSON.stringify(TEST_KEY_A_PUBLIC);
      clearSigningKeyCache();
      await expect(issuePasscard(booking)).rejects.toThrow(
        /must contain private component 'd'/,
      );
    });
  });
});
