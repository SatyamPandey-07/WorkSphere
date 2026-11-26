import { compareHlc, LamportTimestampResolver } from "@/core/sync/LamportTimestampResolver";

describe("LamportTimestampResolver", () => {
  it("prevents logical counter overflow on corrupted remote peer timestamps", () => {
    const resolver = new LamportTimestampResolver({
      nodeId: "peer-local",
      maxLogicalCounter: 1_000,
      maxClockDriftMs: 60_000,
      nowFn: () => 1_700_000_000_000,
    });
    const baseTime = 1_700_000_000_000;
    const result = resolver.receiveRemote(
      {
        wallMs: baseTime,
        logical: Number.MAX_SAFE_INTEGER,
        nodeId: "corrupted-peer",
      },
      baseTime,
    );

    expect(result.timestamp.logical).toBeLessThanOrEqual(1_000);
    expect(Number.isSafeInteger(result.timestamp.logical)).toBe(true);
    expect(result.saturatedLogical).toBe(true);

    const next = resolver.tick(baseTime);
    expect(compareHlc(next, result.timestamp)).toBeGreaterThan(0);
    expect(next.logical).toBeLessThanOrEqual(1_000);
  });

  it("clamps excessive remote clock skew and handles malformed wallMs safely", () => {
    const resolver = new LamportTimestampResolver({
      nodeId: "peer-local",
      maxClockDriftMs: 10_000,
      clockSkewWarningThresholdMs: 1_000_000_000,
      nowFn: () => 500_000,
    });
    const now = 500_000;
    const skewed = resolver.receiveRemote(
      { wallMs: now + 999_999_999, logical: 5, nodeId: "skewed-peer" },
      now,
    );
    expect(skewed.clampedSkew).toBe(true);
    expect(skewed.timestamp.wallMs).toBeLessThanOrEqual(now + 10_000);

    const malformed = resolver.receiveRemote(
      { wallMs: Number.NaN, logical: -42, nodeId: "bad-peer" },
      now + 1_000,
    );
    expect(malformed.rejectedCorrupted).toBe(true);
    expect(Number.isFinite(malformed.timestamp.wallMs)).toBe(true);
    expect(malformed.timestamp.logical).toBeGreaterThanOrEqual(0);
  });

  describe("clock skew warning telemetry", () => {
    let warningSpy: jest.SpyInstance;

    beforeEach(() => {
      warningSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      warningSpy.mockRestore();
    });

    const createResolver = () =>
      new LamportTimestampResolver({
        nodeId: "peer-local",
        clockSkewWarningThresholdMs: 100,
        clockSkewWarningThrottleMs: 5_000,
        nowFn: () => 1_000,
      });

    it("does not warn below the configured threshold", () => {
      const result = createResolver().receiveRemote(
        { wallMs: 1_099, logical: 0, nodeId: "peer-remote" },
        1_000,
      );

      expect(result.clockSkewWarning).toBeUndefined();
      expect(warningSpy).not.toHaveBeenCalled();
    });

    it("warns at the configured threshold and includes skew context", () => {
      const result = createResolver().receiveRemote(
        { wallMs: 1_100, logical: 0, nodeId: "peer-remote" },
        1_000,
      );

      expect(result.clockSkewWarning).toMatchObject({
        event: "hlc.clock_skew_warning",
        remoteNodeId: "peer-remote",
        observedSkewMs: 100,
        warningThresholdMs: 100,
        maxClockDriftMs: 300_000,
        observedAtMs: 1_000,
        willClamp: false,
      });
      expect(warningSpy).toHaveBeenCalledTimes(1);
    });

    it("warns above the configured threshold without changing resolution behavior", () => {
      const resolver = createResolver();
      const result = resolver.receiveRemote(
        { wallMs: 1_101, logical: 0, nodeId: "peer-remote" },
        1_000,
      );

      expect(result.clockSkewWarning?.observedSkewMs).toBe(101);
      expect(result.clampedSkew).toBe(false);
      expect(result.timestamp.wallMs).toBe(1_101);
      expect(warningSpy).toHaveBeenCalledTimes(1);
    });

    it("throttles repeated warnings from the same peer", () => {
      const resolver = createResolver();
      const first = resolver.receiveRemote(
        { wallMs: 1_100, logical: 0, nodeId: "peer-remote" },
        1_000,
      );
      const repeated = resolver.receiveRemote(
        { wallMs: 1_101, logical: 0, nodeId: "peer-remote" },
        1_000,
      );

      expect(first.clockSkewWarning).toBeDefined();
      expect(repeated.clockSkewWarning).toBeUndefined();
      expect(warningSpy).toHaveBeenCalledTimes(1);
    });

    it("emits a later warning after the per-peer throttle interval", () => {
      const resolver = createResolver();
      resolver.receiveRemote(
        { wallMs: 1_100, logical: 0, nodeId: "peer-remote" },
        1_000,
      );

      const laterCrossing = resolver.receiveRemote(
        { wallMs: 6_100, logical: 0, nodeId: "peer-remote" },
        6_000,
      );

      expect(laterCrossing.clockSkewWarning?.observedSkewMs).toBe(100);
      expect(warningSpy).toHaveBeenCalledTimes(2);
    });

    it("does not warn for missing or invalid remote wall timestamps", () => {
      const resolver = createResolver();
      const invalidTimestamps = [
        undefined,
        null,
        {},
        { wallMs: Number.NaN, nodeId: "peer-remote" },
        { wallMs: -1, nodeId: "peer-remote" },
      ];

      for (const remote of invalidTimestamps) {
        const result = resolver.receiveRemote(remote, 1_000);
        expect(result.rejectedCorrupted).toBe(true);
        expect(result.clockSkewWarning).toBeUndefined();
      }

      expect(warningSpy).not.toHaveBeenCalled();
    });
  });
});
