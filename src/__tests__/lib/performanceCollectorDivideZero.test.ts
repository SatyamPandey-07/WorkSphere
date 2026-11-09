import {
  calculateAverageFrameTime,
  calculateFrameMetrics,
  validateTelemetryMetricsPayload,
} from "../../lib/telemetry/collectors/performanceCollector";

describe("performanceCollector - Divide-by-Zero Guards & Payload Validation (#4382)", () => {
  describe("calculateAverageFrameTime", () => {
    test("returns 0 ms when sample buffer is empty", () => {
      expect(calculateAverageFrameTime([])).toBe(0);
      expect(calculateAverageFrameTime(undefined as any)).toBe(0);
      expect(calculateAverageFrameTime(null as any)).toBe(0);
    });

    test("returns 0 ms when totalDurationMs is 0 and no valid frame durations are present", () => {
      expect(calculateAverageFrameTime([], 0)).toBe(0);
      expect(calculateAverageFrameTime([NaN, Infinity, -10], 0)).toBe(0);
    });

    test("calculates valid average frame time when non-zero frame samples exist", () => {
      expect(calculateAverageFrameTime([16.6, 16.7, 16.5], 49.8)).toBe(16.6);
      expect(calculateAverageFrameTime([10, 20, 30])).toBe(20);
    });

    test("filters out invalid NaN and Infinity values without throwing errors", () => {
      expect(calculateAverageFrameTime([10, NaN, 20, Infinity, 30])).toBe(20);
    });
  });

  describe("calculateFrameMetrics", () => {
    test("returns zeroed metrics object for empty sample buffers", () => {
      const metrics = calculateFrameMetrics([], 0);
      expect(metrics).toEqual({
        totalFrames: 0,
        totalDurationMs: 0,
        avgFrameTimeMs: 0,
        fps: 0,
        minFrameTimeMs: 0,
        maxFrameTimeMs: 0,
        p95FrameTimeMs: 0,
      });
    });

    test("calculates FPS and frame statistics for valid frame samples", () => {
      const samples = [16.67, 16.67, 16.67, 16.67, 16.67]; // 5 frames @ ~60fps
      const metrics = calculateFrameMetrics(samples, 83.35);

      expect(metrics.totalFrames).toBe(5);
      expect(metrics.avgFrameTimeMs).toBe(16.67);
      expect(metrics.fps).toBe(60);
      expect(metrics.minFrameTimeMs).toBe(16.67);
      expect(metrics.maxFrameTimeMs).toBe(16.67);
    });
  });

  describe("validateTelemetryMetricsPayload", () => {
    test("sanitizes NaN, Infinity, and negative values to 0", () => {
      const payload = {
        fps: NaN,
        frameTimeMs: Infinity,
        invalidNegative: -15.5,
        validMetric: 60.5,
      };

      const validated = validateTelemetryMetricsPayload(payload);
      expect(validated.fps).toBe(0);
      expect(validated.frameTimeMs).toBe(0);
      expect(validated.invalidNegative).toBe(0);
      expect(validated.validMetric).toBe(60.5);
    });

    test("returns null or non-object payloads unharmed", () => {
      expect(validateTelemetryMetricsPayload(null as any)).toBeNull();
      expect(validateTelemetryMetricsPayload(undefined as any)).toBeUndefined();
    });
  });
});
