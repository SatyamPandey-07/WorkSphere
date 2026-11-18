jest.mock("@/lib/redis", () => ({
  getRedis: jest.fn(() => null),
}));

describe("database telemetry buffer limits", () => {
  let telemetry: typeof import("@/lib/dbTelemetry");
  let randomSpy: jest.SpyInstance;

  beforeEach(async () => {
    jest.resetModules();
    telemetry = await import("@/lib/dbTelemetry");
    randomSpy = jest.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    randomSpy.mockRestore();
  });

  it("keeps detailed samples bounded while preserving exact aggregate counters", async () => {
    for (let index = 0; index < 1_200; index += 1) {
      telemetry.recordQueryDuration(`Model${index}`, index % 2 === 0 ? 100 : 250);
    }

    const firstStatus = telemetry.getDbTelemetryBufferStatus();
    expect(firstStatus.pendingSamples).toBeLessThanOrEqual(1_000);
    expect(firstStatus.inMemorySamples).toBeLessThanOrEqual(1_000);
    expect(firstStatus.circuitBreakerOpen).toBe(true);

    await telemetry.flushTelemetryBuffer();

    for (let index = 0; index < 300; index += 1) {
      telemetry.recordQueryDuration(`NextModel${index}`, 300);
    }

    const status = telemetry.getDbTelemetryBufferStatus();
    const stats = await telemetry.getDbLatencyStats();
    const retainedSamples = stats.byModel.reduce((total, model) => total + model.sampleCount, 0);

    expect(status.inMemorySamples).toBe(1_000);
    expect(status.inMemorySamples).toBeLessThanOrEqual(status.maxInMemorySamples);
    expect(status.pendingSamples).toBeLessThanOrEqual(status.maxPendingSamples);
    expect(retainedSamples).toBe(1_000);
    expect(stats.totalQueryCount).toBe(1_500);
    expect(stats.slowQueryCount).toBe(900);
  });

  it("reduces detailed sampling before opening the circuit breaker", () => {
    for (let index = 0; index < 700; index += 1) {
      telemetry.recordQueryDuration("User", 120);
    }

    const status = telemetry.getDbTelemetryBufferStatus();
    expect(status.sampleRate).toBeLessThan(1);
    expect(status.sampleRate).toBeGreaterThan(0);
    expect(status.circuitBreakerOpen).toBe(false);
  });
});
