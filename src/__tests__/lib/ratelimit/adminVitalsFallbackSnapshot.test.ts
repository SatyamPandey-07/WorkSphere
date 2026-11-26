import {
  buildSystemVitalsSnapshot,
  formatSystemVitalsPrometheus,
  type SystemVitalsSnapshot,
} from "@/lib/export/domain/systemVitalExporter";
import {
  getFallbackTelemetrySnapshot,
  recordFallbackActivation,
  recordFallbackRecovery,
  resetFallbackMetrics,
  getOrCreateFallbackLimiter,
} from "@/lib/rateLimit/tokenBucketFallback";

describe("Admin vitals fallback snapshot export (#10539)", () => {
  beforeEach(() => {
    resetFallbackMetrics();
  });

  it("includes degraded-mode rate-limiter fallback counts and last fallback timestamp in vitals snapshot", () => {
    const fixedNow = 1700000000000;
    recordFallbackActivation("503 Service Unavailable", "tier:mutations", fixedNow);

    const limiter = getOrCreateFallbackLimiter("tier:mutations", 2, 1, 0);
    limiter.consume("user-1", 1, 100);
    limiter.consume("user-1", 1, 100);
    limiter.consume("user-1", 1, 100); // rejected

    const snapshot: SystemVitalsSnapshot = buildSystemVitalsSnapshot();

    expect(snapshot.rateLimitFallback).toBeDefined();
    expect(snapshot.rateLimitFallback?.active).toBe(true);
    expect(snapshot.rateLimitFallback?.activationCount).toBe(1);
    expect(snapshot.rateLimitFallback?.requestCount).toBe(3);
    expect(snapshot.rateLimitFallback?.allowedCount).toBe(2);
    expect(snapshot.rateLimitFallback?.rejectedCount).toBe(1);
    expect(snapshot.rateLimitFallback?.lastActivatedAtMs).toBe(fixedNow);
    expect(snapshot.rateLimitFallback?.lastFallbackTimestamp).toBe(
      new Date(fixedNow).toISOString(),
    );
  });

  it("serializes rate limit fallback metrics in Prometheus output format", () => {
    const fixedNow = 1700000005000;
    recordFallbackActivation("ETIMEDOUT", "tier:search", fixedNow);

    const limiter = getOrCreateFallbackLimiter("tier:search", 1, 1, 0);
    limiter.consume("client-test", 1, 100);
    limiter.consume("client-test", 1, 100);

    const snapshot = buildSystemVitalsSnapshot();
    const prom = formatSystemVitalsPrometheus(snapshot);

    expect(prom).toContain("worksphere_rate_limit_fallback_active 1");
    expect(prom).toContain("worksphere_rate_limit_fallback_activations_total 1");
    expect(prom).toContain("worksphere_rate_limit_fallback_requests_total 2");
    expect(prom).toContain("worksphere_rate_limit_fallback_allowed_total 1");
    expect(prom).toContain("worksphere_rate_limit_fallback_rejected_total 1");
    expect(prom).toContain(
      `worksphere_rate_limit_fallback_last_activated_timestamp_ms ${fixedNow}`,
    );
  });

  it("handles empty or inactive fallback telemetry safely without crashing", () => {
    resetFallbackMetrics();

    const snapshot = buildSystemVitalsSnapshot();
    expect(snapshot.rateLimitFallback).toBeDefined();
    expect(snapshot.rateLimitFallback?.active).toBe(false);
    expect(snapshot.rateLimitFallback?.activationCount).toBe(0);
    expect(snapshot.rateLimitFallback?.requestCount).toBe(0);
    expect(snapshot.rateLimitFallback?.lastActivatedAtMs).toBeNull();
    expect(snapshot.rateLimitFallback?.lastFallbackTimestamp).toBeNull();
  });
});
