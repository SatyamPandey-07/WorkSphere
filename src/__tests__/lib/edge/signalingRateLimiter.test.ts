import { SignalingRateLimiter } from '@/lib/edge/signalingRateLimiter';

describe('SignalingRateLimiter', () => {
  it('allows burst up to capacity, rejects excess with retryAfterMs, and refills smoothly', () => {
    let now = 10_000;
    const limiter = new SignalingRateLimiter({
      capacity: 5,
      refillRatePerSec: 2, // 1 token every 500ms
      nowFn: () => now,
    });

    for (let i = 0; i < 5; i += 1) {
      const res = limiter.consume('peer-a', 1, now);
      expect(res.allowed).toBe(true);
      expect(res.remainingTokens).toBe(4 - i);
      expect(res.retryAfterMs).toBe(0);
    }

    // Burst exhausted
    const blocked = limiter.consume('peer-a', 1, now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remainingTokens).toBe(0);
    expect(blocked.retryAfterMs).toBe(500);

    // Fractional refill after 250ms -> 0.5 tokens (still insufficient for 1 full token)
    now += 250;
    const halfRefill = limiter.consume('peer-a', 1, now);
    expect(halfRefill.allowed).toBe(false);
    expect(halfRefill.remainingTokens).toBe(0.5);
    expect(halfRefill.retryAfterMs).toBe(250);

    // Another 250ms -> 1.0 token available
    now += 250;
    const recovered = limiter.consume('peer-a', 1, now);
    expect(recovered.allowed).toBe(true);
    expect(recovered.remainingTokens).toBe(0);
    expect(recovered.retryAfterMs).toBe(0);
  });

  it('purges idle peer buckets past idleTtlMs', () => {
    let now = 50_000;
    const limiter = new SignalingRateLimiter({
      capacity: 3,
      refillRatePerSec: 1,
      idleTtlMs: 10_000,
      nowFn: () => now,
    });

    limiter.consume('peer-idle', 1, now);
    expect(limiter.activePeerCount(now)).toBe(1);

    now += 9_999;
    expect(limiter.activePeerCount(now)).toBe(1);

    now += 1; // 10_000ms elapsed
    expect(limiter.activePeerCount(now)).toBe(0);
  });
});