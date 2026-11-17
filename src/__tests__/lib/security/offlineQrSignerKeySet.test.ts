import {
  MAX_VERIFICATION_KEYS,
  exportVerificationKeyJwk,
  generateOfflinePasscardKeyPair,
  importVerificationKeys,
  signOfflinePasscard,
  verifyOfflinePasscardWithKeys,
  type OfflinePasscardPayload,
} from "@/lib/security/offlineQrSigner";

const payload: OfflinePasscardPayload = {
  bookingId: "bk_7883",
  userId: "user_1",
  venueId: "venue_1",
  validFrom: 1_800_000_000,
  validUntil: 1_800_028_800,
  seatNumber: "B-12",
};
const during = (payload.validFrom + 60) * 1000;
const before = (payload.validFrom - 60) * 1000;
const after = (payload.validUntil + 60) * 1000;

let historic: CryptoKeyPair;
let active: CryptoKeyPair;
let stranger: CryptoKeyPair;

beforeAll(async () => {
  [historic, active, stranger] = await Promise.all([
    generateOfflinePasscardKeyPair(),
    generateOfflinePasscardKeyPair(),
    generateOfflinePasscardKeyPair(),
  ]);
});

describe("verifyOfflinePasscardWithKeys (#7883)", () => {
  it("accepts a token signed by the active key", async () => {
    const token = await signOfflinePasscard(payload, active.privateKey);
    await expect(
      verifyOfflinePasscardWithKeys(
        token,
        [historic.publicKey, active.publicKey],
        { now: during },
      ),
    ).resolves.toEqual({ valid: true, payload });
  });

  it("accepts a token signed by a retained older key after rotation", async () => {
    const token = await signOfflinePasscard(payload, historic.privateKey);
    await expect(
      verifyOfflinePasscardWithKeys(
        token,
        [active.publicKey, historic.publicKey],
        { now: during },
      ),
    ).resolves.toEqual({ valid: true, payload });
  });

  it("rejects a token that no key in the set signed", async () => {
    const token = await signOfflinePasscard(payload, stranger.privateKey);
    await expect(
      verifyOfflinePasscardWithKeys(
        token,
        [active.publicKey, historic.publicKey],
        { now: during },
      ),
    ).resolves.toEqual({ valid: false, reason: "bad-signature" });
  });

  it("reports the validity window of a genuine token signed by an older key", async () => {
    const token = await signOfflinePasscard(payload, historic.privateKey);
    const keys = [active.publicKey, historic.publicKey];

    await expect(
      verifyOfflinePasscardWithKeys(token, keys, { now: before }),
    ).resolves.toEqual({ valid: false, reason: "not-yet-valid", payload });
    await expect(
      verifyOfflinePasscardWithKeys(token, keys, { now: after }),
    ).resolves.toEqual({ valid: false, reason: "expired", payload });
    await expect(
      verifyOfflinePasscardWithKeys(token, keys, {
        now: after,
        enforceWindow: false,
      }),
    ).resolves.toEqual({ valid: true, payload });
  });

  it("rejects everything when the key set is empty", async () => {
    const token = await signOfflinePasscard(payload, active.privateKey);
    await expect(
      verifyOfflinePasscardWithKeys(token, [], { now: during }),
    ).resolves.toEqual({ valid: false, reason: "bad-signature" });
  });

  it("reports a malformed token as malformed, with or without keys", async () => {
    await expect(
      verifyOfflinePasscardWithKeys("not-a-token", [active.publicKey]),
    ).resolves.toEqual({ valid: false, reason: "malformed" });
    await expect(
      verifyOfflinePasscardWithKeys("not-a-token", []),
    ).resolves.toEqual({ valid: false, reason: "malformed" });
  });

  it(`tries at most ${MAX_VERIFICATION_KEYS} keys`, async () => {
    const token = await signOfflinePasscard(payload, historic.privateKey);
    const fillers = new Array(MAX_VERIFICATION_KEYS).fill(active.publicKey);

    // The matching key sits just past the limit, so it must not be reached.
    await expect(
      verifyOfflinePasscardWithKeys(token, [...fillers, historic.publicKey], {
        now: during,
      }),
    ).resolves.toEqual({ valid: false, reason: "bad-signature" });

    // In the last allowed position it is found.
    await expect(
      verifyOfflinePasscardWithKeys(
        token,
        [...fillers.slice(1), historic.publicKey],
        { now: during },
      ),
    ).resolves.toEqual({ valid: true, payload });
  });
});

describe("importVerificationKeys (#7883)", () => {
  it("imports a JWKS and verifies a token with it", async () => {
    const jwks = {
      keys: [
        {
          ...(await exportVerificationKeyJwk(active.publicKey)),
          kid: "key-active",
          use: "sig",
          alg: "ES256",
        },
        {
          ...(await exportVerificationKeyJwk(historic.publicKey)),
          kid: "key-historic",
        },
      ],
    };
    const keys = await importVerificationKeys(jwks);
    expect(keys).toHaveLength(2);

    const token = await signOfflinePasscard(payload, historic.privateKey);
    await expect(
      verifyOfflinePasscardWithKeys(token, keys, { now: during }),
    ).resolves.toEqual({ valid: true, payload });
  });

  it("accepts a plain array of JWKs", async () => {
    const keys = await importVerificationKeys([
      await exportVerificationKeyJwk(active.publicKey),
    ]);
    expect(keys).toHaveLength(1);
  });

  it("skips entries that are not usable public keys", async () => {
    const good = await exportVerificationKeyJwk(active.publicKey);
    const keys = await importVerificationKeys({
      keys: [
        null,
        "not-a-key",
        { kty: "EC", crv: "P-256" },
        { ...good, d: "private-material" },
        good,
      ],
    });
    expect(keys).toHaveLength(1);
  });

  it("returns no keys for something that is not a key set", async () => {
    await expect(importVerificationKeys(null)).resolves.toEqual([]);
    await expect(importVerificationKeys({})).resolves.toEqual([]);
    await expect(importVerificationKeys({ keys: "nope" })).resolves.toEqual([]);
  });

  it(`reads at most ${MAX_VERIFICATION_KEYS} entries`, async () => {
    const jwk = await exportVerificationKeyJwk(active.publicKey);
    const keys = await importVerificationKeys(
      new Array(MAX_VERIFICATION_KEYS + 5).fill(jwk),
    );
    expect(keys).toHaveLength(MAX_VERIFICATION_KEYS);
  });
});
