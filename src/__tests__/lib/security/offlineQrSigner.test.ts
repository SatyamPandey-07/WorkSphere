import {
  MAX_FIELD_LENGTH,
  SIGNATURE_BYTES,
  decodeOfflinePasscardPayload,
  exportVerificationKeyJwk,
  generateOfflinePasscardKeyPair,
  importSigningKey,
  importVerificationKey,
  signOfflinePasscard,
  verifyOfflinePasscard,
  type OfflinePasscardPayload,
} from "@/lib/security/offlineQrSigner";
import {
  base64UrlToUint8Array,
  uint8ArrayToBase64Url,
} from "@/lib/crypto/encoding";

const payload: OfflinePasscardPayload = {
  bookingId: "bk_7271_a1b2c3",
  userId: "user_2f9d8e7c",
  venueId: "venue_basement_04",
  validFrom: 1_800_000_000,
  validUntil: 1_800_028_800, // 8 hours later
  seatNumber: "B-12",
};

const insideWindow = (payload.validFrom + 60) * 1000;

let pair: CryptoKeyPair;
let otherPair: CryptoKeyPair;
let token: string;

beforeAll(async () => {
  pair = await generateOfflinePasscardKeyPair();
  otherPair = await generateOfflinePasscardKeyPair();
  token = await signOfflinePasscard(payload, pair.privateKey);
});

/** Flips one character of a Base64URL segment to a different valid one. */
function flip(segment: string, index = 3): string {
  const swap = segment[index] === "A" ? "B" : "A";
  return segment.slice(0, index) + swap + segment.slice(index + 1);
}

describe("offlineQrSigner: the token", () => {
  it("is two Base64URL segments, payload then signature, with no padding or unsafe characters", () => {
    const parts = token.split(".");
    expect(parts).toHaveLength(2);
    for (const part of parts) expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("carries a 64-byte raw ECDSA P-256 signature", () => {
    const signature = base64UrlToUint8Array(token.split(".")[1]);
    expect(signature).toHaveLength(SIGNATURE_BYTES);
  });

  it("is compact enough for a QR code that scans reliably", () => {
    expect(token.length).toBeLessThan(300);
  });

  it("gives the same payload segment for the same facts, since the payload is a fixed-order array", async () => {
    const again = await signOfflinePasscard({ ...payload }, pair.privateKey);
    expect(again.split(".")[0]).toBe(token.split(".")[0]);
  });

  it("gives a different signature each time (ECDSA is randomised) and both verify", async () => {
    const again = await signOfflinePasscard(payload, pair.privateKey);
    expect(again.split(".")[1]).not.toBe(token.split(".")[1]);
    expect(
      (
        await verifyOfflinePasscard(again, pair.publicKey, {
          now: insideWindow,
        })
      ).valid,
    ).toBe(true);
  });

  it("can be read back without the key, to show or index it (not to trust it)", () => {
    expect(decodeOfflinePasscardPayload(token)).toEqual(payload);
    expect(decodeOfflinePasscardPayload("nonsense")).toBeNull();
  });
});

describe("offlineQrSigner: verifying", () => {
  it("accepts a genuine token inside its window and returns the facts", async () => {
    const result = await verifyOfflinePasscard(token, pair.publicKey, {
      now: insideWindow,
    });
    expect(result).toEqual({ valid: true, payload });
  });

  it("verifies against the public key alone, after a round trip through a JWK (the venue's key)", async () => {
    const jwk = await exportVerificationKeyJwk(pair.publicKey);
    expect(jwk.d).toBeUndefined();
    const venueKey = await importVerificationKey(jwk);
    expect(
      (await verifyOfflinePasscard(token, venueKey, { now: insideWindow }))
        .valid,
    ).toBe(true);
  });

  it("rejects a token signed by a different key", async () => {
    const result = await verifyOfflinePasscard(token, otherPair.publicKey, {
      now: insideWindow,
    });
    expect(result).toEqual({ valid: false, reason: "bad-signature" });
  });

  it("rejects a token whose payload was changed after signing", async () => {
    const [body, signature] = token.split(".");
    const forged = `${flip(body)}.${signature}`;
    const result = await verifyOfflinePasscard(forged, pair.publicKey, {
      now: insideWindow,
    });
    expect(result).toEqual({ valid: false, reason: "bad-signature" });
  });

  it("rejects a forged seat or a stretched validity window", async () => {
    const edited = (change: (a: unknown[]) => void) => {
      const array = JSON.parse(
        new TextDecoder().decode(base64UrlToUint8Array(token.split(".")[0])),
      );
      change(array);
      const body = uint8ArrayToBase64Url(
        new TextEncoder().encode(JSON.stringify(array)),
      );
      return `${body}.${token.split(".")[1]}`;
    };
    const otherSeat = edited((a) => (a[6] = "A-01"));
    const longer = edited((a) => (a[5] = (a[5] as number) + 86_400));
    for (const forged of [otherSeat, longer]) {
      const result = await verifyOfflinePasscard(forged, pair.publicKey, {
        now: insideWindow,
      });
      expect(result).toEqual({ valid: false, reason: "bad-signature" });
    }
  });

  it("rejects a token whose signature was changed", async () => {
    const [body, signature] = token.split(".");
    const result = await verifyOfflinePasscard(
      `${body}.${flip(signature, 10)}`,
      pair.publicKey,
      {
        now: insideWindow,
      },
    );
    expect(result).toEqual({ valid: false, reason: "bad-signature" });
  });

  it.each([
    ["an empty string", () => ""],
    ["one segment", () => "abc"],
    ["three segments", () => `${token}.AAAA`],
    ["characters outside Base64URL", () => "ab+/=.cd+/="],
    ["a signature of the wrong length", () => `${token.split(".")[0]}.AAAA`],
  ])("calls %s malformed", async (_name, makeBad) => {
    const result = await verifyOfflinePasscard(makeBad(), pair.publicKey, {
      now: insideWindow,
    });
    expect(result).toEqual({ valid: false, reason: "malformed" });
  });

  it("calls a non-string malformed instead of throwing", async () => {
    const result = await verifyOfflinePasscard(
      undefined as unknown as string,
      pair.publicKey,
    );
    expect(result).toEqual({ valid: false, reason: "malformed" });
  });

  it("calls a correctly signed payload of the wrong shape malformed", async () => {
    const body = new TextEncoder().encode(
      JSON.stringify([2, "a", "b", "c", 1, 2, "d"]),
    ); // unknown version
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        pair.privateKey,
        body,
      ),
    );
    const odd = `${uint8ArrayToBase64Url(body)}.${uint8ArrayToBase64Url(signature)}`;
    expect(
      await verifyOfflinePasscard(odd, pair.publicKey, { now: 1500 }),
    ).toEqual({
      valid: false,
      reason: "malformed",
    });
  });
});

describe("offlineQrSigner: the validity window", () => {
  it("is not yet valid before validFrom, and says the token is genuine by returning the facts", async () => {
    const result = await verifyOfflinePasscard(token, pair.publicKey, {
      now: (payload.validFrom - 1) * 1000,
    });
    expect(result).toEqual({ valid: false, reason: "not-yet-valid", payload });
  });

  it("is expired after validUntil", async () => {
    const result = await verifyOfflinePasscard(token, pair.publicKey, {
      now: (payload.validUntil + 1) * 1000,
    });
    expect(result).toEqual({ valid: false, reason: "expired", payload });
  });

  it("is valid on both boundary seconds", async () => {
    for (const second of [payload.validFrom, payload.validUntil]) {
      const result = await verifyOfflinePasscard(token, pair.publicKey, {
        now: second * 1000,
      });
      expect(result.valid).toBe(true);
    }
  });

  it("accepts a Date for now", async () => {
    const result = await verifyOfflinePasscard(token, pair.publicKey, {
      now: new Date(insideWindow),
    });
    expect(result.valid).toBe(true);
  });

  it("checks only the signature when enforceWindow is false", async () => {
    const result = await verifyOfflinePasscard(token, pair.publicKey, {
      now: 0,
      enforceWindow: false,
    });
    expect(result.valid).toBe(true);
  });

  it("uses the current time by default", async () => {
    const spy = jest.spyOn(Date, "now").mockReturnValue(insideWindow);
    try {
      expect((await verifyOfflinePasscard(token, pair.publicKey)).valid).toBe(
        true,
      );
    } finally {
      spy.mockRestore();
    }
  });
});

describe("offlineQrSigner: refusing to sign a bad payload", () => {
  it.each(["bookingId", "userId", "venueId", "seatNumber"] as const)(
    "needs a non-empty %s",
    async (field) => {
      await expect(
        signOfflinePasscard({ ...payload, [field]: "" }, pair.privateKey),
      ).rejects.toThrow(field);
    },
  );

  it("caps text fields so the QR stays small", async () => {
    const long = "x".repeat(MAX_FIELD_LENGTH + 1);
    await expect(
      signOfflinePasscard({ ...payload, seatNumber: long }, pair.privateKey),
    ).rejects.toThrow("seatNumber");
    await expect(
      signOfflinePasscard(
        { ...payload, seatNumber: "x".repeat(MAX_FIELD_LENGTH) },
        pair.privateKey,
      ),
    ).resolves.toEqual(expect.any(String));
  });

  it.each([
    ["a fraction", 1.5],
    ["a negative", -1],
    ["NaN", Number.NaN],
    ["a string", "1800000000" as unknown as number],
  ])(
    "needs validFrom to be whole Unix seconds, not %s",
    async (_name, value) => {
      await expect(
        signOfflinePasscard({ ...payload, validFrom: value }, pair.privateKey),
      ).rejects.toThrow("validFrom");
    },
  );

  it("needs validUntil to be after validFrom", async () => {
    await expect(
      signOfflinePasscard(
        { ...payload, validUntil: payload.validFrom },
        pair.privateKey,
      ),
    ).rejects.toThrow("validUntil");
  });
});

describe("offlineQrSigner: keys", () => {
  it("refuses a verification key that carries the private key", async () => {
    const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    await expect(importVerificationKey(privateJwk)).rejects.toThrow("private");
  });

  it("imports a signing key from a JWK, and the tokens it makes verify with the public key", async () => {
    const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const signingKey = await importSigningKey(privateJwk);
    const made = await signOfflinePasscard(payload, signingKey);
    expect(
      (await verifyOfflinePasscard(made, pair.publicKey, { now: insideWindow }))
        .valid,
    ).toBe(true);
  });

  it("refuses a signing key without the private part", async () => {
    const publicJwk = await exportVerificationKeyJwk(pair.publicKey);
    await expect(importSigningKey(publicJwk)).rejects.toThrow("private key");
  });

  it("fails clearly where Web Crypto is missing", async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", {
      value: undefined,
      configurable: true,
    });
    try {
      await expect(generateOfflinePasscardKeyPair()).rejects.toThrow(
        "Web Crypto",
      );
    } finally {
      if (original) Object.defineProperty(globalThis, "crypto", original);
    }
  });
});
