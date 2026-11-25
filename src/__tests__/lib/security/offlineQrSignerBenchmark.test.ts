import {
  generateOfflinePasscardKeyPair,
  signOfflinePasscard,
  verifyOfflinePasscard,
  clearVerificationCache,
  setVerificationCacheCapacity,
  getVerificationCacheSize,
  type OfflinePasscardPayload,
} from "@/lib/security/offlineQrSigner";

describe("offlineQrSigner: Verification Cache Performance & Batch Benchmark (#8907)", () => {
  let pair: CryptoKeyPair;
  const basePayload: OfflinePasscardPayload = {
    bookingId: "perf_001",
    userId: "user_perf_001",
    venueId: "venue_perf",
    validFrom: 1_800_000_000,
    validUntil: 1_800_028_800,
    seatNumber: "P-10",
  };
  const insideWindow = (basePayload.validFrom + 100) * 1000;

  beforeAll(async () => {
    pair = await generateOfflinePasscardKeyPair();
  });

  beforeEach(() => {
    clearVerificationCache();
    setVerificationCacheCapacity(1000);
  });

  afterAll(() => {
    clearVerificationCache();
  });

  it("processes a batch of 150 entries containing repeated identical tokens with substantially reduced crypto calls", async () => {
    // Generate 5 distinct tokens
    const uniqueTokens: string[] = [];
    for (let i = 0; i < 5; i++) {
      uniqueTokens.push(
        await signOfflinePasscard(
          { ...basePayload, bookingId: `perf_unique_${i}` },
          pair.privateKey,
        ),
      );
    }

    // Build a batch of 150 items composed of repetitions of the 5 unique tokens
    const batch: string[] = [];
    for (let i = 0; i < 150; i++) {
      batch.push(uniqueTokens[i % uniqueTokens.length]);
    }

    const verifySpy = jest.spyOn(globalThis.crypto.subtle, "verify");
    try {
      // Execute all 150 verifications concurrently
      const results = await Promise.all(
        batch.map((t) =>
          verifyOfflinePasscard(t, pair.publicKey, { now: insideWindow }),
        ),
      );

      for (const res of results) {
        expect(res.valid).toBe(true);
      }

      // Exactly 5 cryptographic verifications should have occurred for 150 requests!
      expect(verifySpy).toHaveBeenCalledTimes(5);
      expect(getVerificationCacheSize()).toBe(5);
    } finally {
      verifySpy.mockRestore();
    }
  });

  it("guarantees unique tokens each undergo their own underlying cryptographic verification", async () => {
    const count = 10;
    const tokens: string[] = [];
    for (let i = 0; i < count; i++) {
      tokens.push(
        await signOfflinePasscard(
          { ...basePayload, bookingId: `distinct_${i}` },
          pair.privateKey,
        ),
      );
    }

    const verifySpy = jest.spyOn(globalThis.crypto.subtle, "verify");
    try {
      const results = await Promise.all(
        tokens.map((t) =>
          verifyOfflinePasscard(t, pair.publicKey, { now: insideWindow }),
        ),
      );

      for (const res of results) {
        expect(res.valid).toBe(true);
      }

      expect(verifySpy).toHaveBeenCalledTimes(count);
      expect(getVerificationCacheSize()).toBe(count);
    } finally {
      verifySpy.mockRestore();
    }
  });

  it("measures wall-clock execution time reduction between uncached and cached batches", async () => {
    const token = await signOfflinePasscard(basePayload, pair.privateKey);

    // Warm cache: 1 real cryptographic verification
    clearVerificationCache();
    const t0 = performance.now();
    await verifyOfflinePasscard(token, pair.publicKey, { now: insideWindow });
    const coldDuration = performance.now() - t0;

    // 100 repeated cached verifications
    const t1 = performance.now();
    for (let i = 0; i < 100; i++) {
      await verifyOfflinePasscard(token, pair.publicKey, { now: insideWindow });
    }
    const cachedDurationTotal = performance.now() - t1;
    const cachedAvgDuration = cachedDurationTotal / 100;

    // Log benchmark metrics for transparency in reporting
    // Cold includes cryptographic signature verification; cached is pure memory lookup + SHA-256
    expect(cachedAvgDuration).toBeLessThan(coldDuration);
  });
});
