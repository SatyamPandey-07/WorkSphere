import {
  BatchAttestationNonceManager,
  validateReplayWindowTtl,
  DEFAULT_BATCH_ATTESTATION_NONCE_TTL_MS,
  MIN_BATCH_ATTESTATION_NONCE_TTL_MS,
  MAX_BATCH_ATTESTATION_NONCE_TTL_MS,
  getBatchAttestationNonceManager,
  resetBatchAttestationNonceManager,
} from "@/lib/checkInAttestationNonce";

describe("BatchAttestationNonceManager Replay Window TTL (#10609)", () => {
  let manager: BatchAttestationNonceManager;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-11-26T12:00:00.000Z"));
    manager = new BatchAttestationNonceManager();
  });

  afterEach(() => {
    manager.clear();
    jest.useRealTimers();
  });

  describe("1. TTL Configuration and Validation", () => {
    it("uses default TTL (5 minutes) when no configuration is provided", () => {
      expect(manager.getReplayWindowTtl()).toBe(
        DEFAULT_BATCH_ATTESTATION_NONCE_TTL_MS
      );
      expect(manager.getReplayWindowTtl()).toBe(300_000);
    });

    it("supports custom positive valid replay window TTL", () => {
      const customManager = new BatchAttestationNonceManager({
        replayWindowTtlMs: 60_000, // 1 minute
      });
      expect(customManager.getReplayWindowTtl()).toBe(60_000);

      customManager.setReplayWindowTtl(120_000);
      expect(customManager.getReplayWindowTtl()).toBe(120_000);
    });

    it("rejects non-positive, non-integer, or out-of-bound TTL values", () => {
      // Negative TTL
      expect(() => validateReplayWindowTtl(-1000)).toThrow(RangeError);

      // Zero TTL
      expect(() => validateReplayWindowTtl(0)).toThrow(RangeError);

      // TTL below minimum bound (1000ms)
      expect(() => validateReplayWindowTtl(500)).toThrow(RangeError);

      // TTL above safe maximum (24 hours = 86,400,000ms)
      expect(() =>
        validateReplayWindowTtl(MAX_BATCH_ATTESTATION_NONCE_TTL_MS + 1)
      ).toThrow(RangeError);

      // Non-integer TTL
      expect(() => validateReplayWindowTtl(1234.56)).toThrow(TypeError);

      // Non-number TTL
      expect(() => validateReplayWindowTtl(NaN as any)).toThrow(TypeError);
      expect(() => validateReplayWindowTtl(Infinity as any)).toThrow(TypeError);
    });
  });

  describe("2. Active vs Expired Nonce Replay Protection", () => {
    it("accepts a new nonce and marks it active", () => {
      const res = manager.consumeNonce("nonce-abc-123", {
        venueId: "venue-1",
      });

      expect(res.status).toBe("ACCEPTED");
      expect(res.nonce).toBe("nonce-abc-123");
      expect(manager.isNonceActive("nonce-abc-123", "venue-1")).toBe(true);
    });

    it("rejects duplicate active nonce submissions within the configured window", () => {
      const customManager = new BatchAttestationNonceManager({
        replayWindowTtlMs: 10_000, // 10 seconds
      });

      const first = customManager.consumeNonce("nonce-unique-1");
      expect(first.status).toBe("ACCEPTED");

      // Advance time by 5 seconds (still inside 10s replay window)
      jest.advanceTimersByTime(5_000);

      const replay = customManager.consumeNonce("nonce-unique-1");
      expect(replay.status).toBe("REPLAYED");
      if (replay.status === "REPLAYED") {
        expect(replay.reason).toBe("NONCE_ALREADY_CONSUMED");
      }

      expect(customManager.isNonceActive("nonce-unique-1")).toBe(true);
    });

    it("correctly distinguishes expired nonces from active nonces", () => {
      const customManager = new BatchAttestationNonceManager({
        replayWindowTtlMs: 10_000, // 10 seconds
      });

      customManager.consumeNonce("nonce-expiring-1");
      expect(customManager.isNonceActive("nonce-expiring-1")).toBe(true);

      // Advance time past the 10s TTL
      jest.advanceTimersByTime(10_001);

      // Nonce is expired and no longer active
      expect(customManager.isNonceActive("nonce-expiring-1")).toBe(false);

      // Re-consuming an expired nonce is accepted cleanly (no false replay block after expiry)
      const freshAttempt = customManager.consumeNonce("nonce-expiring-1");
      expect(freshAttempt.status).toBe("ACCEPTED");
    });

    it("prunes expired nonces from memory cleanly", () => {
      const customManager = new BatchAttestationNonceManager({
        replayWindowTtlMs: 5_000,
      });

      customManager.consumeNonce("nonce-1");
      customManager.consumeNonce("nonce-2");

      expect(customManager.size()).toBe(2);

      jest.advanceTimersByTime(5_001);

      const pruned = customManager.pruneExpired();
      expect(pruned).toBe(2);
      expect(customManager.size()).toBe(0);
    });
  });

  describe("3. Singleton Access & Custom Replay Window Override", () => {
    it("supports overriding TTL per batch check-in attestation verification call", () => {
      const res1 = manager.consumeNonce("nonce-override", {
        customTtlMs: 20_000, // 20s instead of default 5m
      });

      expect(res1.status).toBe("ACCEPTED");

      // After 10s, it's still active
      jest.advanceTimersByTime(10_000);
      expect(manager.isNonceActive("nonce-override")).toBe(true);

      // After 21s, it has expired
      jest.advanceTimersByTime(11_000);
      expect(manager.isNonceActive("nonce-override")).toBe(false);
    });

    it("manages global singleton instance cleanly", () => {
      const globalInst = getBatchAttestationNonceManager();
      expect(globalInst).toBeInstanceOf(BatchAttestationNonceManager);

      const resetInst = resetBatchAttestationNonceManager({
        replayWindowTtlMs: 15_000,
      });
      expect(resetInst.getReplayWindowTtl()).toBe(15_000);
    });
  });
});
