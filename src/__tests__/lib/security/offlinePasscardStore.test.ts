import {
  deleteOfflinePasscard,
  getOfflinePasscard,
  pruneExpiredOfflinePasscards,
  saveOfflinePasscard,
  storeOfflinePasscardsFromBooking,
} from "@/lib/security/offlinePasscardStore";
import {
  generateOfflinePasscardKeyPair,
  signOfflinePasscard,
  type OfflinePasscardPayload,
} from "@/lib/security/offlineQrSigner";

const base: OfflinePasscardPayload = {
  bookingId: "bk-1",
  userId: "user-1",
  venueId: "venue-1",
  validFrom: 1_800_000_000,
  validUntil: 1_800_028_800,
  seatNumber: "A-1",
};
const during = (base.validFrom + 60) * 1000;
const after = (base.validUntil + 1) * 1000;

let pair: CryptoKeyPair;
let other: CryptoKeyPair;

const issue = (
  overrides: Partial<OfflinePasscardPayload> = {},
  key = () => pair.privateKey,
) => signOfflinePasscard({ ...base, ...overrides }, key());

beforeAll(async () => {
  pair = await generateOfflinePasscardKeyPair();
  other = await generateOfflinePasscardKeyPair();
});

beforeEach(async () => {
  await pruneExpiredOfflinePasscards(Number.MAX_SAFE_INTEGER);
});

describe("offline passcard store", () => {
  it("keeps a token for its booking and gives it back", async () => {
    const token = await issue();
    const record = await saveOfflinePasscard(token);
    expect(record).toMatchObject({
      bookingId: "bk-1",
      venueId: "venue-1",
      token,
      validUntil: base.validUntil,
    });
    expect(await getOfflinePasscard("bk-1", during)).toBe(token);
  });

  it("gives null for a booking with no token, or no booking id", async () => {
    expect(await getOfflinePasscard("never-stored", during)).toBeNull();
    expect(await getOfflinePasscard("", during)).toBeNull();
  });

  it("keeps one token per booking: a newer one replaces the older", async () => {
    await saveOfflinePasscard(await issue());
    const newer = await issue({ seatNumber: "A-2" });
    await saveOfflinePasscard(newer);
    expect(await getOfflinePasscard("bk-1", during)).toBe(newer);
  });

  it("keeps different bookings apart", async () => {
    const a = await issue({ bookingId: "bk-a" });
    const b = await issue({ bookingId: "bk-b" });
    await saveOfflinePasscard(a);
    await saveOfflinePasscard(b);
    expect(await getOfflinePasscard("bk-a", during)).toBe(a);
    expect(await getOfflinePasscard("bk-b", during)).toBe(b);
  });

  it("never serves an expired token, and removes it", async () => {
    await saveOfflinePasscard(await issue());
    expect(await getOfflinePasscard("bk-1", after)).toBeNull();
    expect(await getOfflinePasscard("bk-1", during)).toBeNull(); // it is gone, not just hidden
  });

  it("serves a token on its last valid second", async () => {
    const token = await issue();
    await saveOfflinePasscard(token);
    expect(await getOfflinePasscard("bk-1", base.validUntil * 1000)).toBe(
      token,
    );
  });

  it("deletes a token", async () => {
    await saveOfflinePasscard(await issue());
    await deleteOfflinePasscard("bk-1");
    expect(await getOfflinePasscard("bk-1", during)).toBeNull();
  });

  it("prunes only the expired tokens and says how many", async () => {
    const live = await issue({
      bookingId: "bk-live",
      validUntil: base.validUntil + 86_400,
    });
    await saveOfflinePasscard(await issue({ bookingId: "bk-old-1" }));
    await saveOfflinePasscard(await issue({ bookingId: "bk-old-2" }));
    await saveOfflinePasscard(live);

    expect(await pruneExpiredOfflinePasscards(after)).toBe(2);
    expect(await getOfflinePasscard("bk-live", after)).toBe(live);
    expect(await pruneExpiredOfflinePasscards(after)).toBe(0);
  });

  it("refuses something that is not a token", async () => {
    await expect(saveOfflinePasscard("not-a-token")).rejects.toThrow(
      "Not a valid offline passcard token",
    );
  });

  it("with a verification key, refuses a token signed by someone else", async () => {
    const forged = await issue({}, () => other.privateKey);
    await expect(
      saveOfflinePasscard(forged, { verificationKey: pair.publicKey }),
    ).rejects.toThrow("bad-signature");
    expect(await getOfflinePasscard("bk-1", during)).toBeNull();
  });

  it("with a verification key, accepts a genuine token even outside its window (a saved future pass)", async () => {
    const token = await issue();
    await expect(
      saveOfflinePasscard(token, { verificationKey: pair.publicKey }),
    ).resolves.toMatchObject({
      token,
    });
  });
});

describe("storing what a booking confirmation returns", () => {
  it("stores the token on a single booking", async () => {
    const token = await issue({ bookingId: "bk-single" });
    expect(
      await storeOfflinePasscardsFromBooking({
        confirmationId: "C1",
        offlinePasscard: token,
      }),
    ).toBe(1);
    expect(await getOfflinePasscard("bk-single", during)).toBe(token);
  });

  it("stores the token of each booking in a list", async () => {
    const one = await issue({ bookingId: "bk-l1" });
    const two = await issue({ bookingId: "bk-l2" });
    const stored = await storeOfflinePasscardsFromBooking([
      { offlinePasscard: one },
      { confirmationId: "no token here" },
      { offlinePasscard: two },
    ]);
    expect(stored).toBe(2);
    expect(await getOfflinePasscard("bk-l2", during)).toBe(two);
  });

  it.each([
    ["nothing", undefined],
    ["null", null],
    ["a booking without a token", { confirmationId: "C2" }],
    ["a token that is not a string", { offlinePasscard: 42 }],
    ["a malformed token", { offlinePasscard: "garbage" }],
  ])("skips %s without throwing", async (_name, data) => {
    await expect(storeOfflinePasscardsFromBooking(data)).resolves.toBe(0);
  });
});
