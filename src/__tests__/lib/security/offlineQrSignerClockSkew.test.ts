import {
  MAX_CLOCK_SKEW_SECONDS,
  generateOfflinePasscardKeyPair,
  signOfflinePasscard,
  verifyOfflinePasscard,
  verifyOfflinePasscardWithKeys,
  type OfflinePasscardPayload,
} from "@/lib/security/offlineQrSigner";

const payload: OfflinePasscardPayload = {
  bookingId: "bk_7885",
  userId: "user_1",
  venueId: "venue_1",
  validFrom: 1_800_000_000,
  validUntil: 1_800_003_600,
  seatNumber: "UNASSIGNED",
};
const startMs = payload.validFrom * 1000;
const endMs = payload.validUntil * 1000;

let pair: CryptoKeyPair;
let token: string;

beforeAll(async () => {
  pair = await generateOfflinePasscardKeyPair();
  token = await signOfflinePasscard(payload, pair.privateKey);
});

const verifyAt = (now: number, clockSkewSeconds?: number) =>
  verifyOfflinePasscard(token, pair.publicKey, { now, clockSkewSeconds });

describe("offline passcard clock skew tolerance (#7885)", () => {
  it("keeps the exact window when no tolerance is given", async () => {
    await expect(verifyAt(startMs)).resolves.toMatchObject({ valid: true });
    await expect(verifyAt(endMs)).resolves.toMatchObject({ valid: true });
    await expect(verifyAt(startMs - 1)).resolves.toMatchObject({
      valid: false,
      reason: "not-yet-valid",
    });
    await expect(verifyAt(endMs + 1)).resolves.toMatchObject({
      valid: false,
      reason: "expired",
    });
  });

  it("accepts a passcard up to the tolerance before validFrom", async () => {
    await expect(verifyAt(startMs - 60_000, 60)).resolves.toMatchObject({
      valid: true,
    });
    await expect(verifyAt(startMs - 60_001, 60)).resolves.toMatchObject({
      valid: false,
      reason: "not-yet-valid",
    });
  });

  it("accepts a passcard up to the tolerance after validUntil", async () => {
    await expect(verifyAt(endMs + 60_000, 60)).resolves.toMatchObject({
      valid: true,
    });
    await expect(verifyAt(endMs + 60_001, 60)).resolves.toMatchObject({
      valid: false,
      reason: "expired",
    });
  });

  it(`caps the tolerance at ${MAX_CLOCK_SKEW_SECONDS} seconds`, async () => {
    const capMs = MAX_CLOCK_SKEW_SECONDS * 1000;
    await expect(verifyAt(endMs + capMs, 3600)).resolves.toMatchObject({
      valid: true,
    });
    await expect(verifyAt(endMs + capMs + 1, 3600)).resolves.toMatchObject({
      valid: false,
      reason: "expired",
    });
  });

  it.each([-60, Number.NaN, Number.POSITIVE_INFINITY])(
    "treats %p as no tolerance",
    async (clockSkewSeconds) => {
      await expect(
        verifyAt(endMs + 1, clockSkewSeconds),
      ).resolves.toMatchObject({ valid: false, reason: "expired" });
      await expect(
        verifyAt(startMs - 1, clockSkewSeconds),
      ).resolves.toMatchObject({ valid: false, reason: "not-yet-valid" });
    },
  );

  it("does not make a forged token acceptable", async () => {
    const other = await generateOfflinePasscardKeyPair();
    const forged = await signOfflinePasscard(payload, other.privateKey);
    await expect(
      verifyOfflinePasscard(forged, pair.publicKey, {
        now: startMs,
        clockSkewSeconds: 60,
      }),
    ).resolves.toEqual({ valid: false, reason: "bad-signature" });
  });

  it("is ignored when the window is not enforced", async () => {
    await expect(
      verifyOfflinePasscard(token, pair.publicKey, {
        now: endMs + 10 * 60_000,
        clockSkewSeconds: 60,
        enforceWindow: false,
      }),
    ).resolves.toEqual({ valid: true, payload });
  });

  it("applies when verifying against a key set", async () => {
    const other = await generateOfflinePasscardKeyPair();
    const keys = [other.publicKey, pair.publicKey];
    await expect(
      verifyOfflinePasscardWithKeys(token, keys, {
        now: endMs + 30_000,
        clockSkewSeconds: 60,
      }),
    ).resolves.toEqual({ valid: true, payload });
    await expect(
      verifyOfflinePasscardWithKeys(token, keys, { now: endMs + 30_000 }),
    ).resolves.toEqual({ valid: false, reason: "expired", payload });
  });
});
