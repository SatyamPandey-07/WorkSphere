import {
  generateOfflinePasscardKeyPair,
  signOfflinePasscard,
  verifyOfflinePasscard,
  verifyOfflinePasscardWithKeys,
  clearVerificationCache,
  setVerificationCacheCapacity,
  getVerificationCacheCapacity,
  getVerificationCacheSize,
  DEFAULT_VERIFICATION_CACHE_CAPACITY,
  type OfflinePasscardPayload,
} from "@/lib/security/offlineQrSigner";

const payloadA: OfflinePasscardPayload = {
  bookingId: "bk_cache_001",
  userId: "user_cache_001",
  venueId: "venue_cache_001",
  validFrom: 1_800_000_000,
  validUntil: 1_800_028_800,
  seatNumber: "A-01",
};

const payloadB: OfflinePasscardPayload = {
  bookingId: "bk_cache_002",
  userId: "user_cache_002",
  venueId: "venue_cache_002",
  validFrom: 1_800_000_000,
  validUntil: 1_800_028_800,
  seatNumber: "B-02",
};

const insideWindow = (payloadA.validFrom + 100) * 1000;

describe("offlineQrSigner: LRU verification cache (#8907)", () => {
  let pairA: CryptoKeyPair;
  let pairB: CryptoKeyPair;
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    pairA = await generateOfflinePasscardKeyPair();
    pairB = await generateOfflinePasscardKeyPair();
    tokenA = await signOfflinePasscard(payloadA, pairA.privateKey);
    tokenB = await signOfflinePasscard(payloadB, pairA.privateKey);
  });

  beforeEach(() => {
    clearVerificationCache();
    setVerificationCacheCapacity(DEFAULT_VERIFICATION_CACHE_CAPACITY);
  });

  afterAll(() => {
    clearVerificationCache();
    setVerificationCacheCapacity(DEFAULT_VERIFICATION_CACHE_CAPACITY);
  });

  it("1. a valid signature verifies successfully", async () => {
    const result = await verifyOfflinePasscard(tokenA, pairA.publicKey, {
      now: insideWindow,
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.bookingId).toBe(payloadA.bookingId);
    }
  });

  it("2. repeated verification of the same token uses the cached result", async () => {
    const verifySpy = jest.spyOn(globalThis.crypto.subtle, "verify");
    try {
      expect(getVerificationCacheSize()).toBe(0);

      // First verification: cache miss -> performs subtle.verify()
      const first = await verifyOfflinePasscard(tokenA, pairA.publicKey, {
        now: insideWindow,
      });
      expect(first.valid).toBe(true);
      expect(getVerificationCacheSize()).toBe(1);
      const callCountAfterFirst = verifySpy.mock.calls.length;
      expect(callCountAfterFirst).toBeGreaterThanOrEqual(1);

      // Second verification: cache hit -> skips subtle.verify()
      const second = await verifyOfflinePasscard(tokenA, pairA.publicKey, {
        now: insideWindow,
      });
      expect(second.valid).toBe(true);
      expect(verifySpy.mock.calls.length).toBe(callCountAfterFirst);
      expect(getVerificationCacheSize()).toBe(1);
    } finally {
      verifySpy.mockRestore();
    }
  });

  it("3. invalid signatures are never cached as successful", async () => {
    const verifySpy = jest.spyOn(globalThis.crypto.subtle, "verify");
    try {
      expect(getVerificationCacheSize()).toBe(0);

      // Verify with wrong key -> failure
      const result = await verifyOfflinePasscard(tokenA, pairB.publicKey, {
        now: insideWindow,
      });
      expect(result.valid).toBe(false);
      expect((result as any).reason).toBe("bad-signature");
      expect(getVerificationCacheSize()).toBe(0);

      // Second check: still triggers underlying verify because failure was not cached
      const second = await verifyOfflinePasscard(tokenA, pairB.publicKey, {
        now: insideWindow,
      });
      expect(second.valid).toBe(false);
      expect(getVerificationCacheSize()).toBe(0);
      expect(verifySpy.mock.calls.length).toBe(2);
    } finally {
      verifySpy.mockRestore();
    }
  });

  it("4. malformed tokens do not populate the cache", async () => {
    const malformedTokens = [
      "",
      "bad.token.with.too.many.dots",
      "not_base64!",
      "aW52YWxpZA", // single part
    ];

    for (const badToken of malformedTokens) {
      const res = await verifyOfflinePasscard(badToken, pairA.publicKey);
      expect(res.valid).toBe(false);
      expect((res as any).reason).toBe("malformed");
      expect(getVerificationCacheSize()).toBe(0);
    }
  });

  it("5. different tokens do not share cache entries", async () => {
    const resA = await verifyOfflinePasscard(tokenA, pairA.publicKey, {
      now: insideWindow,
    });
    const resB = await verifyOfflinePasscard(tokenB, pairA.publicKey, {
      now: insideWindow,
    });

    expect(resA.valid).toBe(true);
    expect(resB.valid).toBe(true);
    expect(getVerificationCacheSize()).toBe(2);
    if (resA.valid && resB.valid) {
      expect(resA.payload.bookingId).toBe(payloadA.bookingId);
      expect(resB.payload.bookingId).toBe(payloadB.bookingId);
    }
  });

  it("6. different public keys or verification contexts do not incorrectly share results", async () => {
    // Token signed with pairB
    const tokenSignedByB = await signOfflinePasscard(
      payloadA,
      pairB.privateKey,
    );

    // Verify tokenA with pairA -> genuine
    const resA = await verifyOfflinePasscard(tokenA, pairA.publicKey, {
      now: insideWindow,
    });
    expect(resA.valid).toBe(true);

    // Verify tokenA with pairB -> invalid signature (must not hit pairA's cache entry)
    const resB = await verifyOfflinePasscard(tokenA, pairB.publicKey, {
      now: insideWindow,
    });
    expect(resB.valid).toBe(false);
    expect((resB as any).reason).toBe("bad-signature");

    // Verify tokenSignedByB with pairB -> genuine (must have its own cache entry)
    const resBSigned = await verifyOfflinePasscard(
      tokenSignedByB,
      pairB.publicKey,
      {
        now: insideWindow,
      },
    );
    expect(resBSigned.valid).toBe(true);
  });

  it("7. LRU recency updates when an entry is accessed and 8. LRU eviction evicts oldest", async () => {
    setVerificationCacheCapacity(2);
    expect(getVerificationCacheCapacity()).toBe(2);

    const token3 = await signOfflinePasscard(
      { ...payloadA, bookingId: "bk_003" },
      pairA.privateKey,
    );

    const verifySpy = jest.spyOn(globalThis.crypto.subtle, "verify");
    try {
      // 1. Insert tokenA
      await verifyOfflinePasscard(tokenA, pairA.publicKey, {
        now: insideWindow,
      });
      // 2. Insert tokenB
      await verifyOfflinePasscard(tokenB, pairA.publicKey, {
        now: insideWindow,
      });
      expect(getVerificationCacheSize()).toBe(2);

      // Access tokenA -> refreshes tokenA recency (making tokenB the LRU item)
      await verifyOfflinePasscard(tokenA, pairA.publicKey, {
        now: insideWindow,
      });

      // 3. Insert token3 -> should evict tokenB (the LRU entry)
      await verifyOfflinePasscard(token3, pairA.publicKey, {
        now: insideWindow,
      });
      expect(getVerificationCacheSize()).toBe(2);

      // Now verify tokenA -> should be a CACHE HIT (not evicted)
      const callsBeforeVerifyA = verifySpy.mock.calls.length;
      await verifyOfflinePasscard(tokenA, pairA.publicKey, {
        now: insideWindow,
      });
      expect(verifySpy.mock.calls.length).toBe(callsBeforeVerifyA); // 0 additional subtle calls!

      // Verify tokenB -> should be a CACHE MISS (was evicted)
      const callsBeforeVerifyB = verifySpy.mock.calls.length;
      await verifyOfflinePasscard(tokenB, pairA.publicKey, {
        now: insideWindow,
      });
      expect(verifySpy.mock.calls.length).toBe(callsBeforeVerifyB + 1); // 1 additional subtle call
    } finally {
      verifySpy.mockRestore();
    }
  });

  it("9. cache capacity is strictly bounded", async () => {
    const bound = 5;
    setVerificationCacheCapacity(bound);
    expect(getVerificationCacheCapacity()).toBe(bound);

    for (let i = 0; i < 15; i++) {
      const t = await signOfflinePasscard(
        { ...payloadA, bookingId: `bk_bound_${i}` },
        pairA.privateKey,
      );
      await verifyOfflinePasscard(t, pairA.publicKey, { now: insideWindow });
      expect(getVerificationCacheSize()).toBeLessThanOrEqual(bound);
    }
    expect(getVerificationCacheSize()).toBe(bound);
  });

  it("10. concurrent verification of the same token triggers only one underlying cryptographic verification", async () => {
    const verifySpy = jest.spyOn(globalThis.crypto.subtle, "verify");
    try {
      const concurrency = 25;
      const promises = Array.from({ length: concurrency }, () =>
        verifyOfflinePasscard(tokenA, pairA.publicKey, { now: insideWindow }),
      );

      const results = await Promise.all(promises);
      for (const res of results) {
        expect(res.valid).toBe(true);
      }

      // Exactly 1 subtle.verify call occurred across all 25 concurrent calls!
      expect(verifySpy).toHaveBeenCalledTimes(1);
      expect(getVerificationCacheSize()).toBe(1);
    } finally {
      verifySpy.mockRestore();
    }
  });

  it("11. concurrent verification of different tokens can proceed independently", async () => {
    const tokens = await Promise.all([
      signOfflinePasscard(
        { ...payloadA, bookingId: "indep_1" },
        pairA.privateKey,
      ),
      signOfflinePasscard(
        { ...payloadA, bookingId: "indep_2" },
        pairA.privateKey,
      ),
      signOfflinePasscard(
        { ...payloadA, bookingId: "indep_3" },
        pairA.privateKey,
      ),
    ]);

    const verifySpy = jest.spyOn(globalThis.crypto.subtle, "verify");
    try {
      const results = await Promise.all(
        tokens.map((t) =>
          verifyOfflinePasscard(t, pairA.publicKey, { now: insideWindow }),
        ),
      );

      for (const res of results) {
        expect(res.valid).toBe(true);
      }
      expect(verifySpy).toHaveBeenCalledTimes(3);
      expect(getVerificationCacheSize()).toBe(3);
    } finally {
      verifySpy.mockRestore();
    }
  });

  it("12. failed or rejected verification promises are removed from the in-flight map", async () => {
    const verifySpy = jest
      .spyOn(globalThis.crypto.subtle, "verify")
      .mockImplementationOnce(async () => {
        throw new Error("Transient cryptographic device error");
      });

    try {
      // First attempt fails due to unexpected error
      const res1 = await verifyOfflinePasscard(tokenA, pairA.publicKey, {
        now: insideWindow,
      });
      expect(res1.valid).toBe(false);
      expect((res1 as any).reason).toBe("bad-signature");
      expect(getVerificationCacheSize()).toBe(0);

      // 13. A later valid retry succeeds after an earlier failure
      const res2 = await verifyOfflinePasscard(tokenA, pairA.publicKey, {
        now: insideWindow,
      });
      expect(res2.valid).toBe(true);
      expect(getVerificationCacheSize()).toBe(1);
    } finally {
      verifySpy.mockRestore();
    }
  });

  it("14. key rotation or cache invalidation prevents reuse of obsolete verification results", async () => {
    const verifySpy = jest.spyOn(globalThis.crypto.subtle, "verify");
    try {
      // Warm cache
      const res = await verifyOfflinePasscard(tokenA, pairA.publicKey, {
        now: insideWindow,
      });
      expect(res.valid).toBe(true);
      expect(getVerificationCacheSize()).toBe(1);
      const callsBefore = verifySpy.mock.calls.length;

      // Invalidate cache
      clearVerificationCache();
      expect(getVerificationCacheSize()).toBe(0);

      // Verification after clear must re-verify against underlying crypto
      const resAfterClear = await verifyOfflinePasscard(
        tokenA,
        pairA.publicKey,
        {
          now: insideWindow,
        },
      );
      expect(resAfterClear.valid).toBe(true);
      expect(verifySpy.mock.calls.length).toBe(callsBefore + 1);
    } finally {
      verifySpy.mockRestore();
    }
  });

  it("15. existing passcard verification and issuance behavior remains unchanged with multi-key verification", async () => {
    const keys = [pairB.publicKey, pairA.publicKey];
    const res = await verifyOfflinePasscardWithKeys(tokenA, keys, {
      now: insideWindow,
    });
    expect(res.valid).toBe(true);
    if (res.valid) {
      expect(res.payload.bookingId).toBe(payloadA.bookingId);
    }
  });

  it("evaluates temporal validity window dynamically even on cache hit", async () => {
    // 1. Verify within window -> valid
    const res1 = await verifyOfflinePasscard(tokenA, pairA.publicKey, {
      now: insideWindow,
    });
    expect(res1.valid).toBe(true);

    // 2. Verify with time before validFrom -> not-yet-valid, but returns payload
    const resBefore = await verifyOfflinePasscard(tokenA, pairA.publicKey, {
      now: (payloadA.validFrom - 100) * 1000,
    });
    expect(resBefore.valid).toBe(false);
    expect((resBefore as any).reason).toBe("not-yet-valid");
    expect((resBefore as any).payload.bookingId).toBe(payloadA.bookingId);

    // 3. Verify with time after validUntil -> expired, but returns payload
    const resAfter = await verifyOfflinePasscard(tokenA, pairA.publicKey, {
      now: (payloadA.validUntil + 100) * 1000,
    });
    expect(resAfter.valid).toBe(false);
    expect((resAfter as any).reason).toBe("expired");
    expect((resAfter as any).payload.bookingId).toBe(payloadA.bookingId);
  });
});
