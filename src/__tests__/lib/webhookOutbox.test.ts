import { computeWebhookRetryDelayMs } from "@/lib/events/outbox";

/** Deterministic PRNG so distribution assertions never flake. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("durable webhook outbox retry policy", () => {
  describe("full jitter bounds", () => {
    it("draws uniformly from the whole backoff window", () => {
      expect(computeWebhookRetryDelayMs(1, 0)).toBe(1_000);
      expect(computeWebhookRetryDelayMs(1, 0.5)).toBe(30_000);
      expect(computeWebhookRetryDelayMs(1, 1)).toBe(60_000);
    });

    it("doubles the window per attempt", () => {
      expect(computeWebhookRetryDelayMs(2, 1)).toBe(120_000);
      expect(computeWebhookRetryDelayMs(3, 1)).toBe(240_000);
      expect(computeWebhookRetryDelayMs(3, 0.25)).toBe(60_000);
      expect(computeWebhookRetryDelayMs(4, 0.5)).toBe(240_000);
    });

    it("never exceeds the window ceiling", () => {
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const ceiling = 60_000 * 2 ** (attempt - 1);
        for (const random of [0, 0.001, 0.5, 0.999, 1]) {
          const delay = computeWebhookRetryDelayMs(attempt, random);
          expect(delay).toBeGreaterThanOrEqual(1_000);
          expect(delay).toBeLessThanOrEqual(ceiling);
        }
      }
    });

    it("caps the window at 24 hours", () => {
      expect(computeWebhookRetryDelayMs(20, 1)).toBe(24 * 60 * 60 * 1000);
      expect(computeWebhookRetryDelayMs(20, 0.5)).toBe(12 * 60 * 60 * 1000);
    });

    it("returns whole milliseconds", () => {
      const random = mulberry32(7);
      for (let i = 0; i < 100; i += 1) {
        expect(Number.isInteger(computeWebhookRetryDelayMs(2, random()))).toBe(
          true,
        );
      }
    });
  });

  describe("input normalization", () => {
    it("clamps out-of-range random draws", () => {
      expect(computeWebhookRetryDelayMs(1, -2)).toBe(1_000);
      expect(computeWebhookRetryDelayMs(1, 2)).toBe(60_000);
    });

    it("falls back to Math.random for a non-finite draw", () => {
      const delay = computeWebhookRetryDelayMs(1, Number.NaN);
      expect(delay).toBeGreaterThanOrEqual(1_000);
      expect(delay).toBeLessThanOrEqual(60_000);
    });

    it("normalizes invalid attempt numbers to the first attempt", () => {
      for (const attempt of [0, -3, 1.9, Number.NaN]) {
        expect(computeWebhookRetryDelayMs(attempt, 0.5)).toBe(30_000);
      }
    });
  });

  describe("burst dispersion", () => {
    it("spreads a synchronized batch across the backoff window", () => {
      const random = mulberry32(0x7736);
      // The regression from #7736: 20 events queued against one failing
      // endpoint shared a scheduled retry timestamp, so they retried together.
      const delays = Array.from({ length: 20 }, () =>
        computeWebhookRetryDelayMs(1, random()),
      );

      expect(new Set(delays).size).toBeGreaterThan(15);
      expect(Math.max(...delays) - Math.min(...delays)).toBeGreaterThan(30_000);
    });

    it("is uniform across the window", () => {
      const random = mulberry32(42);
      const samples = Array.from({ length: 400 }, () =>
        computeWebhookRetryDelayMs(1, random()),
      );

      const mean = samples.reduce((sum, d) => sum + d, 0) / samples.length;
      expect(mean).toBeGreaterThan(27_000);
      expect(mean).toBeLessThan(33_000);

      const deciles = Array.from({ length: 10 }, () => 0);
      for (const delay of samples) {
        const bucket = Math.min(9, Math.floor((delay / 60_000) * 10));
        deciles[bucket] += 1;
      }
      expect(Math.min(...deciles)).toBeGreaterThan(15);
    });

    it("does not repeat the same delay between calls", () => {
      const samples = Array.from({ length: 20 }, () =>
        computeWebhookRetryDelayMs(1),
      );
      expect(new Set(samples).size).toBeGreaterThan(1);
    });
  });
});
