import {
  getPublicJwks,
  getActiveSigningJwk,
  sanitizeAndValidatePublicJwk,
  MAX_RETAINED_PUBLIC_KEYS,
} from "@/lib/security/keyRotation";

const PUB_KEY_A = {
  kty: "EC",
  crv: "P-256",
  x: "IwWS2R4U7Cy2eRCIXQI48oi6anob6NKcLR6dIuBomeE",
  y: "BigMwQiCn-va5Vir-gCK-KZJ_sj-6yZtcYzn8mhNFJk",
  use: "sig",
  alg: "ES256",
  kid: "key-2026-a",
};

const PUB_KEY_B = {
  kty: "EC",
  crv: "P-256",
  x: "R9acpTPjzIK8jblzvui300LZB3rgzIz-VpMWvcrlceU",
  y: "L6tqHREL7ZgmOV-nCHTW1CG0BicaMkfZZeQHmDctsFA",
  use: "sig",
  alg: "ES256",
  kid: "key-2026-b",
};

const PRIV_KEY_A = {
  kty: "EC",
  crv: "P-256",
  x: "IwWS2R4U7Cy2eRCIXQI48oi6anob6NKcLR6dIuBomeE",
  y: "BigMwQiCn-va5Vir-gCK-KZJ_sj-6yZtcYzn8mhNFJk",
  d: "OWvPLPNEV7FibA5_g9P7E7YB21xEwT57jQdhnVhdiqQ",
};

describe("keyRotation utilities (#7820)", () => {
  const origPublicEnv = process.env.OFFLINE_PASSCARD_PUBLIC_JWKS;
  const origPrivateEnv = process.env.OFFLINE_PASSCARD_PRIVATE_KEY_JWK;

  afterEach(() => {
    if (origPublicEnv !== undefined) {
      process.env.OFFLINE_PASSCARD_PUBLIC_JWKS = origPublicEnv;
    } else {
      delete process.env.OFFLINE_PASSCARD_PUBLIC_JWKS;
    }
    if (origPrivateEnv !== undefined) {
      process.env.OFFLINE_PASSCARD_PRIVATE_KEY_JWK = origPrivateEnv;
    } else {
      delete process.env.OFFLINE_PASSCARD_PRIVATE_KEY_JWK;
    }
  });

  describe("sanitizeAndValidatePublicJwk", () => {
    it("accepts a valid EC P-256 public JWK and preserves allowed fields", () => {
      const clean = sanitizeAndValidatePublicJwk(PUB_KEY_A);
      expect(clean).toEqual(PUB_KEY_A);
    });

    it("strips unapproved fields and strictly refuses private component d", () => {
      const withPrivate = { ...PUB_KEY_A, d: "super-secret-d" };
      expect(sanitizeAndValidatePublicJwk(withPrivate)).toBeNull();

      const withExtra = { ...PUB_KEY_A, randomMeta: "strip-me" };
      const cleaned = sanitizeAndValidatePublicJwk(withExtra);
      expect(cleaned).toEqual(PUB_KEY_A);
      expect((cleaned as any).randomMeta).toBeUndefined();
    });

    it("rejects non-P-256 or non-EC keys", () => {
      expect(sanitizeAndValidatePublicJwk({ ...PUB_KEY_A, kty: "RSA" })).toBeNull();
      expect(sanitizeAndValidatePublicJwk({ ...PUB_KEY_A, crv: "P-384" })).toBeNull();
    });

    it("rejects missing coordinates", () => {
      expect(sanitizeAndValidatePublicJwk({ ...PUB_KEY_A, x: "" })).toBeNull();
      expect(sanitizeAndValidatePublicJwk({ ...PUB_KEY_A, y: undefined })).toBeNull();
    });
  });

  describe("getPublicJwks", () => {
    it("returns an empty array when env is absent or empty", () => {
      delete process.env.OFFLINE_PASSCARD_PUBLIC_JWKS;
      expect(getPublicJwks()).toEqual([]);

      process.env.OFFLINE_PASSCARD_PUBLIC_JWKS = "   ";
      expect(getPublicJwks()).toEqual([]);
    });

    it("returns sanitized public key array when properly configured", () => {
      process.env.OFFLINE_PASSCARD_PUBLIC_JWKS = JSON.stringify({
        keys: [PUB_KEY_A, PUB_KEY_B],
      });
      const keys = getPublicJwks();
      expect(keys).toHaveLength(2);
      expect(keys[0]).toEqual(PUB_KEY_A);
      expect(keys[1]).toEqual(PUB_KEY_B);
    });

    it("verifies consistency between active private signing key and published JWKS", () => {
      process.env.OFFLINE_PASSCARD_PRIVATE_KEY_JWK = JSON.stringify(PRIV_KEY_A);
      // Valid matching JWKS
      process.env.OFFLINE_PASSCARD_PUBLIC_JWKS = JSON.stringify({
        keys: [PUB_KEY_A],
      });
      expect(() => getPublicJwks()).not.toThrow();

      // Mismatched JWKS (active key not in JWKS)
      process.env.OFFLINE_PASSCARD_PUBLIC_JWKS = JSON.stringify({
        keys: [PUB_KEY_B],
      });
      expect(() => getPublicJwks()).toThrow(
        /Active signing key in OFFLINE_PASSCARD_PRIVATE_KEY_JWK does not match any public key in OFFLINE_PASSCARD_PUBLIC_JWKS/,
      );
    });

    it("requires a stable kid on every published key", () => {
      const keyWithoutKid = { ...PUB_KEY_A, kid: undefined };
      process.env.OFFLINE_PASSCARD_PUBLIC_JWKS = JSON.stringify({
        keys: [keyWithoutKid],
      });
      expect(() => getPublicJwks()).toThrow(/missing a required stable 'kid'/);
    });

    it("rejects duplicate kid values across keys", () => {
      process.env.OFFLINE_PASSCARD_PUBLIC_JWKS = JSON.stringify({
        keys: [PUB_KEY_A, { ...PUB_KEY_B, kid: PUB_KEY_A.kid }],
      });
      expect(() => getPublicJwks()).toThrow(/duplicate key identifier/);
    });

    it("throws descriptive error when JSON is invalid", () => {
      process.env.OFFLINE_PASSCARD_PUBLIC_JWKS = "not-json";
      expect(() => getPublicJwks()).toThrow(/not valid JSON/);
    });

    it("throws when keys is not an array", () => {
      process.env.OFFLINE_PASSCARD_PUBLIC_JWKS = JSON.stringify({ keys: "not-array" });
      expect(() => getPublicJwks()).toThrow(/must be a JSON object containing a 'keys' array/);
    });

    it("throws if any individual key is invalid or contains private material", () => {
      process.env.OFFLINE_PASSCARD_PUBLIC_JWKS = JSON.stringify({
        keys: [PUB_KEY_A, { ...PUB_KEY_B, d: "secret" }],
      });
      expect(() => getPublicJwks()).toThrow(/contains invalid or malformed public JWK at index 1/);
    });

    it("enforces MAX_RETAINED_PUBLIC_KEYS boundary", () => {
      const manyKeys = Array.from({ length: MAX_RETAINED_PUBLIC_KEYS + 1 }, (_, i) => ({
        ...PUB_KEY_A,
        kid: `key-${i}`,
      }));
      process.env.OFFLINE_PASSCARD_PUBLIC_JWKS = JSON.stringify({ keys: manyKeys });
      expect(() => getPublicJwks()).toThrow(/exceeding the maximum/);
    });
  });

  describe("getActiveSigningJwk", () => {
    it("returns null when env is missing or empty", () => {
      delete process.env.OFFLINE_PASSCARD_PRIVATE_KEY_JWK;
      expect(getActiveSigningJwk()).toBeNull();

      process.env.OFFLINE_PASSCARD_PRIVATE_KEY_JWK = "  ";
      expect(getActiveSigningJwk()).toBeNull();
    });

    it("throws when env contains invalid JSON or malformed key structure", () => {
      process.env.OFFLINE_PASSCARD_PRIVATE_KEY_JWK = "not-json";
      expect(() => getActiveSigningJwk()).toThrow(/not valid JSON/);

      process.env.OFFLINE_PASSCARD_PRIVATE_KEY_JWK = JSON.stringify({ kty: "RSA" });
      expect(() => getActiveSigningJwk()).toThrow(/must be a valid EC P-256 private JWK/);
    });

    it("returns parsed object when valid", () => {
      process.env.OFFLINE_PASSCARD_PRIVATE_KEY_JWK = JSON.stringify(PRIV_KEY_A);
      expect(getActiveSigningJwk()).toEqual(PRIV_KEY_A);
    });
  });
});
