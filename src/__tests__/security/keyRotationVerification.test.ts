import {
  issuePasscard,
  clearSigningKeyCache,
  PRIVATE_JWK_ENV,
} from "@/lib/security/serverOfflinePasscardIssuer";
import {
  verifyOfflinePasscard,
  importVerificationKey,
} from "@/lib/security/offlineQrSigner";
import { getPublicJwks } from "@/lib/security/keyRotation";

// Keypair 1 (Historic key)
const KEY_1_PRIVATE = {
  kty: "EC",
  crv: "P-256",
  x: "IwWS2R4U7Cy2eRCIXQI48oi6anob6NKcLR6dIuBomeE",
  y: "BigMwQiCn-va5Vir-gCK-KZJ_sj-6yZtcYzn8mhNFJk",
  d: "OWvPLPNEV7FibA5_g9P7E7YB21xEwT57jQdhnVhdiqQ",
};
const KEY_1_PUBLIC = {
  kty: "EC",
  crv: "P-256",
  x: "IwWS2R4U7Cy2eRCIXQI48oi6anob6NKcLR6dIuBomeE",
  y: "BigMwQiCn-va5Vir-gCK-KZJ_sj-6yZtcYzn8mhNFJk",
  kid: "key-historic-1",
  use: "sig",
  alg: "ES256",
};

// Keypair 2 (Current active key)
const KEY_2_PRIVATE = {
  kty: "EC",
  crv: "P-256",
  x: "R9acpTPjzIK8jblzvui300LZB3rgzIz-VpMWvcrlceU",
  y: "L6tqHREL7ZgmOV-nCHTW1CG0BicaMkfZZeQHmDctsFA",
  d: "gQ7nixnvGATHJDg7r0sX3DP0aE77h-ccFEg3ATiDQ2M",
};
const KEY_2_PUBLIC = {
  kty: "EC",
  crv: "P-256",
  x: "R9acpTPjzIK8jblzvui300LZB3rgzIz-VpMWvcrlceU",
  y: "L6tqHREL7ZgmOV-nCHTW1CG0BicaMkfZZeQHmDctsFA",
  kid: "key-active-2",
  use: "sig",
  alg: "ES256",
};

// Keypair 3 (Untrusted/Retired key not in JWKS)
const KEY_3_PUBLIC = {
  kty: "EC",
  crv: "P-256",
  x: "PysbbKnCffgzeopLpsajO22p6OfBAzcgcKVbTKrH58w",
  y: "Y10CPGgeQ44idl9qc1wNG-K1ieaNsgcx929YUNWI6FI",
  kid: "key-untrusted-3",
};

describe("Key Rotation & Multi-Key Offline Verification (#7820)", () => {
  const origPrivate = process.env[PRIVATE_JWK_ENV];
  const origPublic = process.env.OFFLINE_PASSCARD_PUBLIC_JWKS;

  afterEach(() => {
    clearSigningKeyCache();
    if (origPrivate !== undefined) process.env[PRIVATE_JWK_ENV] = origPrivate;
    else delete process.env[PRIVATE_JWK_ENV];
    if (origPublic !== undefined) process.env.OFFLINE_PASSCARD_PUBLIC_JWKS = origPublic;
    else delete process.env.OFFLINE_PASSCARD_PUBLIC_JWKS;
  });

  it("verifies tokens signed by historic and active keys across rotation without token format changes", async () => {
    // Phase 1: Key 1 is active. Issue token 1.
    process.env[PRIVATE_JWK_ENV] = JSON.stringify(KEY_1_PRIVATE);
    clearSigningKeyCache();

    const token1 = await issuePasscard({
      id: "bk-rotation-1",
      userId: "usr-rot-1",
      venueId: "vn-rot",
      startsAt: new Date(Date.now() + 3600_000),
      seatNumber: "Desk-1",
    });

    // Phase 2: Key rotation occurs.
    // Key 2 becomes active signing key.
    // Public JWKS contains both active Key 2 and retained historic Key 1.
    process.env[PRIVATE_JWK_ENV] = JSON.stringify(KEY_2_PRIVATE);
    process.env.OFFLINE_PASSCARD_PUBLIC_JWKS = JSON.stringify({
      keys: [KEY_2_PUBLIC, KEY_1_PUBLIC],
    });
    clearSigningKeyCache();

    // Issue token 2 using the new active key
    const token2 = await issuePasscard({
      id: "bk-rotation-2",
      userId: "usr-rot-2",
      venueId: "vn-rot",
      startsAt: new Date(Date.now() + 7200_000),
      seatNumber: "Desk-2",
    });

    // Retrieve public verification keys from JWKS
    const publicJwks = getPublicJwks();
    expect(publicJwks).toHaveLength(2);

    const verificationKeys = await Promise.all(
      publicJwks.map((jwk) => importVerificationKey(jwk)),
    );

    // Verifier function that iterates over bounded retained keys
    async function verifyWithKeySet(token: string) {
      for (const key of verificationKeys) {
        const result = await verifyOfflinePasscard(token, key, {
          enforceWindow: false,
        });
        if (result.valid) return result;
      }
      return { valid: false as const, reason: "bad-signature" as const };
    }

    // Token 1 (signed with Key 1) must verify successfully against retained keys
    const res1 = await verifyWithKeySet(token1);
    expect(res1.valid).toBe(true);
    if (res1.valid) {
      expect(res1.payload.bookingId).toBe("bk-rotation-1");
    }

    // Token 2 (signed with Key 2) must verify successfully
    const res2 = await verifyWithKeySet(token2);
    expect(res2.valid).toBe(true);
    if (res2.valid) {
      expect(res2.payload.bookingId).toBe("bk-rotation-2");
    }

    // A token signed with untrusted Key 3 must fail verification
    const untrustedKey = await importVerificationKey(KEY_3_PUBLIC);
    const untrustedResult = await verifyOfflinePasscard(token1, untrustedKey, {
      enforceWindow: false,
    });
    expect(untrustedResult.valid).toBe(false);
  });
});
